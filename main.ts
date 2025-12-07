import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';

type DeletionMode = "archive" | "obsidian-trash" | "system-trash" | "permanent";

interface TimedPostsSettings {
	defaultDurationMin: number;
	warnThresholdMin: number;
	graceSeconds: number;
	deletionMode: DeletionMode;
	archiveFolder: string;
	timedPostsFolder: string;
	templateFilePath: string;
	statusBarEnabled: boolean;
}

const DEFAULT_SETTINGS: TimedPostsSettings = {
	defaultDurationMin: 60,
	warnThresholdMin: 5,
	graceSeconds: 10,
	deletionMode: "archive",
	archiveFolder: "Failed Timed Posts",
	timedPostsFolder: "",
	templateFilePath: "",
	statusBarEnabled: true,
};

type ActiveTimer = {
	path: string;
	createdAt: number;   // epoch ms
	expiresAt: number;   // epoch ms (UTC)
};

type PluginState = {
	active?: ActiveTimer | null;
};

export default class TimedPostsPlugin extends Plugin {
	settings: TimedPostsSettings;
	state: PluginState = {};
	tickHandle: number | null = null;
	statusEl: HTMLElement | null = null;
	inGrace = false;
	graceEndsAt = 0;
	hasWarned = false;

	async onload() {
		await this.loadSettings();
		await this.loadState();

		// Status bar
		if (this.settings.statusBarEnabled) {
			this.statusEl = this.addStatusBarItem();
			this.statusEl.setText("⏱️ —");
			this.statusEl.addClass("timed-posts-status");
		}

		// Ribbon icon
                this.addRibbonIcon('clock', 'Start Timed Post', async () => {
                        await this.promptAndStart();
                });

		// Commands
                this.addCommand({
                        id: "start-timed-post",
                        name: "Start Timed Post",
                        callback: async () => {
                                await this.promptAndStart();
                        },
                });

		this.addCommand({
			id: "complete-timed-post",
			name: "Complete Timed Post",
			callback: () => this.completeActive(),
		});

		this.addCommand({
			id: "cancel-timed-post",
			name: "Cancel Timed Post (Archive/Delete)",
			callback: () => this.failActive(true),
		});

		// Settings tab
		this.addSettingTab(new TimedPostsSettingsTab(this.app, this));

		// Start ticking
		this.startTick();
	}

	onunload() {
		if (this.tickHandle) window.clearInterval(this.tickHandle);
	}

	// ---------- Core flow ----------

	async promptAndStart() {
		if (this.state.active) {
			new Notice("A timed post is already active.");
			return;
		}

		const minutes = await this.promptForDuration();
		if (!minutes || minutes <= 0) return;

		const file = await this.createTimedNote(minutes);
		if (!file) return;

		const now = Date.now();
		const expiresAt = now + minutes * 60_000;

                this.state.active = {
                        path: file.path,
                        createdAt: now,
                        expiresAt,
                };
                await this.saveState();

                await this.writeFrontmatterTimer(file, expiresAt);
                new Notice(`Timer started for ${minutes} min: ${file.basename}`);
                await this.revealFile(file);
        }

	async completeActive() {
		const timer = await this.getActiveFile();
		if (!timer) return;

		const file = timer.file;
		await this.markComplete(file);
		this.state.active = null;
		this.inGrace = false;
		this.hasWarned = false;
		await this.saveState();
		new Notice("Timed post completed ✅");
	}

	async failActive(userInitiated = false) {
		const timer = await this.getActiveFile();
		if (!timer) return;

		const file = timer.file;
		await this.handleFailure(file);
		this.state.active = null;
		this.inGrace = false;
		this.hasWarned = false;
		await this.saveState();
		new Notice(userInitiated ? "Timed post cancelled." : "Timed post failed (time's up).");
	}

	// ---------- Tick loop ----------

	startTick() {
		this.tickHandle = window.setInterval(() => this.tick(), 1000);
	}

	async tick() {
		// Update status/countdown
		if (!this.state.active) {
			if (this.statusEl) this.statusEl.setText("⏱️ —");
			return;
		}

		const active = this.state.active;
		const file = this.app.vault.getAbstractFileByPath(active.path);
		if (!(file instanceof TFile)) {
			// File missing -> clear timer
			this.state.active = null;
			await this.saveState();
			if (this.statusEl) this.statusEl.setText("⏱️ —");
			return;
		}

		const msLeft = active.expiresAt - Date.now();
		if (this.statusEl) {
			this.statusEl.setText(`⏱️ ${formatMs(msLeft)} (${file.basename})`);
		}

		// Warning threshold
		if (msLeft <= this.settings.warnThresholdMin * 60_000 && msLeft > 0 && !this.hasWarned) {
			new Notice("⚠️ Timed post running out of time!");
			this.hasWarned = true;
		}

		// Expired: enter grace or fail
		if (msLeft <= 0) {
			const now = Date.now();
			if (!this.inGrace) {
				this.inGrace = true;
				// If grace period is 0, fail immediately without showing modal
				if (this.settings.graceSeconds === 0) {
					await this.failActive(false);
				} else {
					this.graceEndsAt = now + this.settings.graceSeconds * 1000;
					this.showGraceModal(file);
				}
			} else if (now >= this.graceEndsAt) {
				await this.failActive(false);
			}
		}
	}

	// ---------- Helpers ----------

	async getActiveFile(): Promise<{ file: TFile; data: ActiveTimer } | null> {
		const data = this.state.active;
		if (!data) {
			new Notice("No active timed post.");
			return null;
		}
		const file = this.app.vault.getAbstractFileByPath(data.path);
		if (!(file instanceof TFile)) {
			new Notice("Timed post file not found.");
			this.state.active = null;
			await this.saveState();
			return null;
		}
		return { file, data };
	}

	async createTimedNote(minutes: number): Promise<TFile | null> {
		// Decide folder
		let folder: TFolder | null = null;
		if (this.settings.timedPostsFolder) {
			const maybe = this.app.vault.getAbstractFileByPath(this.settings.timedPostsFolder);
			if (maybe instanceof TFolder) {
				folder = maybe;
			} else {
				try {
					folder = await this.app.vault.createFolder(this.settings.timedPostsFolder);
				} catch {
					folder = null;
				}
			}
		}

		const now = new Date();
		const name = `Timed Post ${formatDateFile(now)}.md`;
		const path = folder ? `${folder.path}/${name}` : name;

		// Base content
		let body = "";
		if (this.settings.templateFilePath) {
			const tfile = this.app.vault.getAbstractFileByPath(this.settings.templateFilePath);
			if (tfile instanceof TFile) {
				body = await this.app.vault.read(tfile);
			}
		}

		// Insert minimal frontmatter stub
		const fm = [
			"---",
			"timed-post: true",
			`timed-created-at: ${toIsoUtc(now)}`,
			"---",
			"",
		].join("\n");

		try {
			const file = await this.app.vault.create(path, fm + body);
			return file;
		} catch (error) {
			new Notice("Failed to create timed post file.");
			console.error(error);
			return null;
		}
	}

	async writeFrontmatterTimer(file: TFile, expiresAt: number) {
		const expiresIso = toIsoUtc(new Date(expiresAt));
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm["timed-post"] = true;
			fm["timer-expires"] = expiresIso;
			if (!fm["timed-created-at"]) {
				fm["timed-created-at"] = toIsoUtc(new Date());
			}
		});
	}

	async markComplete(file: TFile) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm["timed-post"] = false;
			delete fm["timer-expires"];
			fm["completed-at"] = toIsoUtc(new Date());
		});
	}

	async handleFailure(file: TFile) {
		switch (this.settings.deletionMode) {
			case "archive": {
				const folderPath = this.settings.archiveFolder?.trim() || "Failed Timed Posts";
				let folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (!(folder instanceof TFolder)) {
					try {
						folder = await this.app.vault.createFolder(folderPath);
					} catch {
						folder = null;
					}
				}
				const newPath = folder ? `${folder.path}/${file.name}` : `${folderPath}/${file.name}`;
				try {
					await this.app.vault.rename(file, newPath);
					await this.app.fileManager.processFrontMatter(file, (fm) => {
						fm["timed-post"] = false;
						fm["failed-at"] = toIsoUtc(new Date());
						fm["failed-reason"] = "expired";
					});
				} catch (error) {
					console.error("Failed to archive timed post:", error);
				}
				break;
			}
			case "obsidian-trash":
				await this.app.vault.trash(file, false);
				break;
			case "system-trash":
				await this.app.vault.trash(file, true);
				break;
			case "permanent":
				await this.app.vault.delete(file);
				break;
		}
	}

	showGraceModal(file: TFile) {
		const seconds = this.settings.graceSeconds;
		const plugin = this;
		const m = new Modal(this.app);
		m.setTitle("⏰ Time's up!");
		
		const body = m.contentEl.createDiv();
		body.createEl("p", { 
			text: `"${file.basename}" will be archived/deleted in ${seconds} seconds.`,
			cls: "timed-posts-grace-message"
		});
		
		const buttonContainer = body.createDiv({ cls: "modal-button-container" });
		
		const completeBtn = buttonContainer.createEl("button", { 
			text: "Complete now",
			cls: "mod-cta"
		});
		
		const letFailBtn = buttonContainer.createEl("button", { 
			text: "Let it fail"
		});

		completeBtn.onclick = async () => {
			m.close();
			await plugin.completeActive();
		};
		
		letFailBtn.onclick = () => {
			m.close();
			// Timer will continue and fail when grace period ends
		};

		m.open();
	}

	async revealFile(file: TFile) {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	async promptForDuration(): Promise<number | null> {
		return new Promise((resolve) => {
			const modal = new DurationModal(this.app, this.settings.defaultDurationMin, (minutes) => {
				resolve(minutes);
			});
			modal.open();
		});
	}

	// ---------- Persistence ----------

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadState() {
		try {
			const raw = await this.app.vault.adapter.read(this.manifest.dir + "/state.json");
			this.state = JSON.parse(raw);
		} catch {
			this.state = {};
		}

		// If active exists but already expired past grace on load, fail now
		if (this.state.active) {
			const file = this.app.vault.getAbstractFileByPath(this.state.active.path);
			if (!(file instanceof TFile)) {
				this.state.active = null;
				await this.saveState();
			} else if (Date.now() > this.state.active.expiresAt + this.settings.graceSeconds * 1000) {
				await this.handleFailure(file);
				this.state.active = null;
				await this.saveState();
			}
		}
	}

	async saveState() {
		await this.app.vault.adapter.write(
			this.manifest.dir + "/state.json",
			JSON.stringify(this.state, null, 2)
		);
	}
}

// ---------- Duration Modal ----------

class DurationModal extends Modal {
	defaultMinutes: number;
	onSubmit: (minutes: number | null) => void;

	constructor(app: App, defaultMinutes: number, onSubmit: (minutes: number | null) => void) {
		super(app);
		this.defaultMinutes = defaultMinutes;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Start Timed Post" });

		const inputContainer = contentEl.createDiv({ cls: "timed-posts-input-container" });
		inputContainer.createEl("label", { text: "Duration (minutes):" });
		
		const input = inputContainer.createEl("input", {
			type: "number",
			value: String(this.defaultMinutes),
		});
		input.focus();
		input.select();

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		
		const startBtn = buttonContainer.createEl("button", {
			text: "Start",
			cls: "mod-cta",
		});

		const cancelBtn = buttonContainer.createEl("button", {
			text: "Cancel",
		});

		const submit = () => {
			const minutes = Number(input.value);
			this.close();
			this.onSubmit(minutes > 0 ? minutes : null);
		};

		startBtn.onclick = submit;
		cancelBtn.onclick = () => {
			this.close();
			this.onSubmit(null);
		};

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				submit();
			} else if (e.key === "Escape") {
				this.close();
				this.onSubmit(null);
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ---------- Settings UI ----------

class TimedPostsSettingsTab extends PluginSettingTab {
	plugin: TimedPostsPlugin;

	constructor(app: App, plugin: TimedPostsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Timed Posts Settings" });

		new Setting(containerEl)
			.setName("Default duration (minutes)")
			.setDesc("Default time limit for new timed posts")
			.addText(text => text
				.setValue(String(this.plugin.settings.defaultDurationMin))
				.onChange(async (value) => {
					const num = Number(value);
					if (num > 0) {
						this.plugin.settings.defaultDurationMin = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Warning threshold (minutes)")
			.setDesc("Show warning when this many minutes remain (0 = no warning)")
			.addText(text => text
				.setValue(String(this.plugin.settings.warnThresholdMin))
				.onChange(async (value) => {
					const num = Number(value);
					if (num >= 0) {
						this.plugin.settings.warnThresholdMin = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Grace period (seconds)")
			.setDesc("Final warning time before archiving/deletion (0 = instant deletion, no dialog)")
			.addText(text => text
				.setValue(String(this.plugin.settings.graceSeconds))
				.onChange(async (value) => {
					const num = Number(value);
					if (num >= 0) {
						this.plugin.settings.graceSeconds = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Deletion mode")
			.setDesc("What happens to failed timed posts")
			.addDropdown(dropdown => dropdown
				.addOptions({
					"archive": "Archive to folder (recommended)",
					"obsidian-trash": "Obsidian trash",
					"system-trash": "System trash",
					"permanent": "Permanent delete (danger!)",
				})
				.setValue(this.plugin.settings.deletionMode)
				.onChange(async (value: DeletionMode) => {
					this.plugin.settings.deletionMode = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Archive folder")
			.setDesc("Folder for archived failed posts (when using archive mode)")
			.addText(text => text
				.setPlaceholder("Failed Timed Posts")
				.setValue(this.plugin.settings.archiveFolder)
				.onChange(async (value) => {
					this.plugin.settings.archiveFolder = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Timed posts folder")
			.setDesc("Folder where new timed posts are created (leave empty for vault root)")
			.addText(text => text
				.setPlaceholder("(vault root)")
				.setValue(this.plugin.settings.timedPostsFolder)
				.onChange(async (value) => {
					this.plugin.settings.timedPostsFolder = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Template file path")
			.setDesc("Optional template file to use for new timed posts")
			.addText(text => text
				.setPlaceholder("Templates/Timed Post.md")
				.setValue(this.plugin.settings.templateFilePath)
				.onChange(async (value) => {
					this.plugin.settings.templateFilePath = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Show status bar")
			.setDesc("Display countdown timer in status bar")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.statusBarEnabled)
				.onChange(async (value) => {
					this.plugin.settings.statusBarEnabled = value;
					await this.plugin.saveSettings();
					new Notice("Restart Obsidian to apply status bar changes");
				}));
	}
}

// ---------- Utility functions ----------

function toIsoUtc(d: Date): string {
	return d.toISOString();
}

function formatDateFile(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function formatMs(ms: number): string {
	if (ms <= 0) return "00:00";
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
