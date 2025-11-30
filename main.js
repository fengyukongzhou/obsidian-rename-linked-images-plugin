const { Plugin, Notice, Modal, PluginSettingTab, MarkdownView, Setting } = require('obsidian');

const DEFAULT_SETTINGS = {
	prefix: 'zd',
	useDate: true,
	dateFormat: 'MMDD',
	startIndex: 1,
	padLength: 3,
	linkFormat: 'wiki' // 'wiki' or 'markdown'
};

class RenameLinkedImagesPlugin extends Plugin {
	settings = DEFAULT_SETTINGS;

	async onload() {
		console.log('加载插件: Rename Linked Images');
		
		await this.loadSettings();
		
		this.addCommand({
			id: 'rename-linked-images',
			name: '重命名当前笔记的关联图片',
			callback: () => this.renameImagesInCurrentNote(),
		});
		
		console.log('已注册重命名图片命令');
		
		this.addCommand({
			id: 'convert-wiki-to-markdown',
			name: 'Wiki转Markdown链接',
			callback: () => {
				console.log('Wiki转Markdown链接 命令被触发');
				this.convertWikiToMarkdown();
			},
		});
		
		console.log('已注册Wiki转Markdown命令');
		
		this.addCommand({
			id: 'convert-markdown-to-wiki',
			name: 'Markdown转Wiki链接',
			callback: () => {
				console.log('Markdown转Wiki链接 命令被触发');
				this.convertMarkdownToWiki();
			},
		});
		
		console.log('已注册Markdown转Wiki命令');
		
		this.addSettingTab(new RenameLinkedImagesSettingTab(this.app, this));
		
		console.log('插件加载完成');
	}

	onunload() {
		console.log('卸载插件: Rename Linked Images');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async renameImagesInCurrentNote() {
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('请先打开一个笔记');
			return;
		}
		
		if (activeFile.extension !== 'md') {
			new Notice('只支持Markdown文件');
			return;
		}
		
		try {
			// 保存当前编辑器状态
			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			const cursor = editor?.getCursor();
			const scrollInfo = editor?.getScrollInfo();
			
			// 获取文件信息，在读取内容前保存创建时间
			const fileStat = activeFile.stat;
			const originalCreateTime = fileStat.ctime || fileStat.mtime;
			
			const content = await this.app.vault.read(activeFile);
			const imageLinks = this.extractImageLinks(content);
			
			if (imageLinks.length === 0) {
				new Notice('未找到图片链接');
				return;
			}
			
			const prefix = await this.askForPrefix();
			if (!prefix) {
				return;
			}
			
			const renameMapping = this.generateRenameMapping(imageLinks, activeFile, prefix, originalCreateTime);
			
			if (Object.keys(renameMapping).length === 0) {
				new Notice('所有图片已使用该缩写命名，无需修改');
				return;
			}
			
			const confirmMsg = `找到 ${Object.keys(renameMapping).length} 个图片需要重命名，是否继续？`;
			if (!confirm(confirmMsg)) {
				return;
			}
			
			const renamedCount = await this.renameImageFiles(renameMapping, activeFile);
			
			if (renamedCount === 0) {
				new Notice('没有图片被重命名');
				return;
			}
			
			const newContent = this.updateContent(content, renameMapping);
			
			// 只有当内容真正改变时才修改文件
			if (newContent !== content) {
				// 使用最基本的方式修改文件，避免触发编辑器事件
				// 先禁用编辑器的自动保存
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const originalDirty = view?.state?.mode === 'source';
				
				try {
					// 直接修改文件内容
					await this.app.vault.modify(activeFile, newContent);
				} catch (error) {
					console.error('修改文件失败:', error);
					throw error;
				}
			} else {
				// 如果内容没有改变，直接返回，不触发文件修改
				new Notice(`没有需要更新的内容`);
			}
			
			new Notice(`成功重命名 ${renamedCount} 个图片文件`);
			
		} catch (error) {
			console.error('重命名图片失败:', error);
			new Notice(`重命名失败: ${error.message}`);
		}
	}

	async convertWikiToMarkdown() {
		console.log('convertWikiToMarkdown 被调用');
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('请先打开一个笔记');
			return;
		}
		
		if (activeFile.extension !== 'md') {
			new Notice('只支持Markdown文件');
			return;
		}
		
		try {
			const content = await this.app.vault.read(activeFile);
			console.log('读取文件内容成功，长度:', content.length);
			
			// 查找所有 Wiki 链接 - 使用更宽松的正则表达式
			// 尝试多种可能的格式
			const patterns = [
				/!\[\[([^\|\]]+)(?:\|([^\]]*))?\]\]/g,  // 标准格式
				/!\[\[([^\]]+)\]\]/g,  // 无描述格式
				/!\[\[([^\|]+)\|([^\]]+)\]\]/g  // 有描述格式
			];
			
			let wikiLinks = [];
			patterns.forEach(pattern => {
				const matches = content.match(pattern);
				if (matches) {
					wikiLinks = wikiLinks.concat(matches);
				}
			});
			console.log('找到的 Wiki 链接:', wikiLinks);
			
			// 输出文件前100个字符以便调试
			console.log('文件内容预览:', content.substring(0, 100));
			
			const newContent = content.replace(/!\[\[([^\|\]]+)(?:\|([^\]]*))?\]\]/g, (match, fileName, altText) => {
				console.log('匹配到:', match, '文件名:', fileName, '描述:', altText);
				// 处理 Wiki 图片链接
				if (altText && altText.trim() !== '') {
					return `![${altText}](${fileName})`;
				} else {
					return `![](${fileName})`;
				}
			});
			
			if (newContent === content) {
				new Notice('没有需要转换的Wiki链接');
				return;
			}
			
			if (!confirm('确定要将所有Wiki链接转换为Markdown格式吗？')) {
				return;
			}
			
			// 使用最基本的方式修改文件
			await this.app.vault.modify(activeFile, newContent);
			new Notice('成功转换Wiki链接为Markdown格式');
			
		} catch (error) {
			console.error('转换链接格式失败:', error);
			new Notice(`转换失败: ${error.message}`);
		}
	}

	async convertMarkdownToWiki() {
		console.log('convertMarkdownToWiki 被调用');
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('请先打开一个笔记');
			return;
		}
		
		if (activeFile.extension !== 'md') {
			new Notice('只支持Markdown文件');
			return;
		}
		
		try {
			const content = await this.app.vault.read(activeFile);
			console.log('读取文件内容成功，长度:', content.length);
			
			// 查找所有 Markdown 链接 - 使用更宽松的正则表达式
			const mdPatterns = [
				/!\[([^\]]*)\]\(([^)]+)\)/g,  // 标准格式
				/!\[\]\(([^)]+)\)/g,  // 无描述格式
				/!\[([^\]]+)\]\(([^)]+)\)/g  // 有描述格式
			];
			
			let mdLinks = [];
			mdPatterns.forEach(pattern => {
				const matches = content.match(pattern);
				if (matches) {
					mdLinks = mdLinks.concat(matches);
				}
			});
			console.log('找到的 Markdown 链接:', mdLinks);
			
			// 输出文件前100个字符以便调试
			console.log('文件内容预览:', content.substring(0, 100));
			
			const newContent = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, altText, fileName) => {
				console.log('匹配到:', match, '描述:', altText, '文件名:', fileName);
				// 处理 Markdown 图片链接
				if (altText && altText.trim() !== '') {
					return `![[${fileName}|${altText}]]`;
				} else {
					return `![[${fileName}]]`;
				}
			});
			
			if (newContent === content) {
				new Notice('没有需要转换的Markdown链接');
				return;
			}
			
			if (!confirm('确定要将所有Markdown链接转换为Wiki格式吗？')) {
				return;
			}
			
			// 使用最基本的方式修改文件
			await this.app.vault.modify(activeFile, newContent);
			new Notice('成功转换Markdown链接为Wiki格式');
			
		} catch (error) {
			console.error('转换链接格式失败:', error);
			new Notice(`转换失败: ${error.message}`);
		}
	}

	extractImageLinks(content) {
		const obsidianRegex = /!\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;
		const markdownRegex = /!\[[^\]]*\]\(([^\s)]+)\)/g;
		
		const links = [];
		const seen = new Set();
		let match;
		
		// 重置正则表达式的lastIndex以确保从头开始匹配
		obsidianRegex.lastIndex = 0;
		while ((match = obsidianRegex.exec(content)) !== null) {
			const fileName = match[1].trim();
			if (!seen.has(fileName)) {
				links.push(fileName);
				seen.add(fileName);
			}
		}
		
		// 重置正则表达式的lastIndex
		markdownRegex.lastIndex = 0;
		while ((match = markdownRegex.exec(content)) !== null) {
			const fileName = match[1].trim();
			if (!seen.has(fileName)) {
				links.push(fileName);
				seen.add(fileName);
			}
		}
		
		return links;
	}

	async askForPrefix() {
		return new Promise((resolve) => {
			const modal = new PrefixInputModal(this.app, resolve);
			modal.open();
		});
	}

	generateRenameMapping(imageLinks, noteFile, customPrefix = null, originalCreateTime = null) {
		const mapping = {};
		// 使用传入的原始创建时间，如果没有则使用文件stat中的时间
		const fileTime = originalCreateTime || noteFile.stat.ctime || noteFile.stat.mtime;
		const date = new Date(fileTime);
		const dateStr = this.formatDate(date);
		
		const prefix = customPrefix || this.settings.prefix;
		
		const validRegex = new RegExp(`^${prefix}${dateStr}-\d{${this.settings.padLength}}\.\w+$`);
		const imagesToRename = imageLinks.filter(img => !validRegex.test(img));
		
		// 不再排序，保持文档中出现顺序
		let index = this.settings.startIndex;
		
		for (const oldName of imagesToRename) {
			const ext = oldName.includes('.') ? oldName.substring(oldName.lastIndexOf('.')) : '.png';
			const newName = this.generateNewNameWithPrefix(dateStr, index, ext, prefix);
			mapping[oldName] = newName;
			index++;
		}
		
		return mapping;
	}

	formatDate(date) {
		if (!this.settings.useDate) return '';
		
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		
		switch (this.settings.dateFormat) {
			case 'MMDD': return month + day;
			case 'DDMM': return day + month;
			case 'YYMMDD': {
				const year = String(date.getFullYear()).substring(2);
				return year + month + day;
			}
			default: return month + day;
		}
	}

	generateNewName(dateStr, index, ext) {
		const paddedIndex = String(index).padStart(this.settings.padLength, '0');
		return `${this.settings.prefix}${dateStr}-${paddedIndex}${ext}`;
	}

	generateNewNameWithPrefix(dateStr, index, ext, prefix) {
		const paddedIndex = String(index).padStart(this.settings.padLength, '0');
		return `${prefix}${dateStr}-${paddedIndex}${ext}`;
	}

	async renameImageFiles(renameMapping, activeFile) {
		let count = 0;
		
		for (const [oldName, newName] of Object.entries(renameMapping)) {
			try {
				const oldFile = this.app.metadataCache.getFirstLinkpathDest(oldName, activeFile.path);
				
				if (!oldFile) {
					console.warn(`图片不存在: ${oldName}`);
					continue;
				}
				
				const newPath = oldFile.parent.path + '/' + newName;
				
				const newFile = this.app.vault.getAbstractFileByPath(newPath);
				if (newFile) {
					console.warn(`目标文件已存在: ${newPath}`);
					continue;
				}
				
				await this.app.fileManager.renameFile(oldFile, newPath);
				count++;
				
			} catch (error) {
				console.error(`重命名失败 ${oldName} -> ${newName}:`, error);
			}
		}
		
		return count;
	}

	updateContent(content, renameMapping) {
		if (Object.keys(renameMapping).length === 0) return content;
		
		const patterns = Object.keys(renameMapping).map(old => 
			this.escapeRegex(old)
		).join('|');
		
		const wikiRegex = new RegExp(`!\\[\\[(${patterns})(?:\\|([^\\]]*))?\\]\\]`, 'g');
		const mdRegex = new RegExp(`!\\[([^\\]]*)\\]\\((${patterns})\\)`, 'g');
		
		let newContent = content.replace(wikiRegex, (match, oldName, altText) => {
			const newName = renameMapping[oldName];
			if (!newName) return match;
			return altText ? `![[${newName}|${altText}]]` : `![[${newName}]]`;
		});
		
		newContent = newContent.replace(mdRegex, (match, altText, oldName) => {
			const newName = renameMapping[oldName];
			if (!newName) return match;
			
			if (this.settings.linkFormat === 'wiki') {
				return altText ? `![[${newName}|${altText}]]` : `![[${newName}]]`;
			} else {
				return `![${altText}](${newName})`;
			}
		});
		
		// 只有在确实进行了替换操作时才清理空行
		if (newContent !== content) {
			// 清理可能的多余空行，特别是文件开头
			// 移除开头的多余空行（保留最多2个空行）
			newContent = newContent.replace(/^\s{0,2}\n(\s{0,2}\n){2,}/g, '\n\n');
		}
		
		return newContent;
	}

	escapeRegex(str) {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}

class PrefixInputModal extends Modal {
	constructor(app, onSubmit) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { text: '输入图片前缀' });
		
		const input = contentEl.createEl('input', {
			type: 'text',
			placeholder: '例如: zd, img, pic'
		});
		input.style.width = '100%';
		input.style.marginBottom = '10px';
		
		const buttonContainer = contentEl.createEl('div', {
			cls: 'modal-button-container'
		});
		
		const confirmBtn = buttonContainer.createEl('button', {
			text: '确认',
			cls: 'mod-cta'
		});
		confirmBtn.onclick = () => {
			const prefix = input.value.trim();
			if (prefix) {
				this.onSubmit(prefix);
				this.close();
			} else {
				new Notice('请输入前缀');
			}
		};
		
		const cancelBtn = buttonContainer.createEl('button', {
			text: '取消'
		});
		cancelBtn.onclick = () => {
			this.onSubmit(null);
			this.close();
		};
		
		input.focus();
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				confirmBtn.click();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class RenameLinkedImagesSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Rename Linked Images 设置' });

		new Setting(containerEl)
			.setName('说明')
			.setDesc('运行命令时会要求输入自定义前缀，设置中的前缀仅作为默认值')
			.setHeading();

		new Setting(containerEl)
			.setName('默认前缀')
			.setDesc('图片文件名的前缀（例如：zd、img、pic）')
			.addText(text => text
				.setPlaceholder('zd')
				.setValue(this.plugin.settings.prefix)
				.onChange(async (value) => {
					this.plugin.settings.prefix = value;
					await this.plugin.saveSettings();
					this.display(); // 刷新显示以更新示例
				}));

		new Setting(containerEl)
			.setName('包含日期')
			.setDesc('是否在文件名中包含日期')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useDate)
				.onChange(async (value) => {
					this.plugin.settings.useDate = value;
					await this.plugin.saveSettings();
					this.display(); // 刷新显示以更新示例
				}));

		new Setting(containerEl)
			.setName('日期格式')
			.setDesc('选择日期的显示格式')
			.addDropdown(dropdown => dropdown
				.addOption('MMDD', '月日 (1128)')
				.addOption('DDMM', '日月 (2811)')
				.addOption('YYMMDD', '年月日 (251128)')
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
					this.display(); // 刷新显示以更新示例
				}));

		new Setting(containerEl)
			.setName('序号位数')
			.setDesc('序号的位数，例如：3 = 001, 002...')
			.addSlider(slider => slider
				.setLimits(1, 5, 1)
				.setValue(this.plugin.settings.padLength)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.padLength = value;
					await this.plugin.saveSettings();
					this.display(); // 刷新显示以更新示例
				}));

		new Setting(containerEl)
			.setName('起始序号')
			.setDesc('重命名时的起始序号')
			.addSlider(slider => slider
				.setLimits(1, 100, 1)
				.setValue(this.plugin.settings.startIndex)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.startIndex = value;
					await this.plugin.saveSettings();
					this.display(); // 刷新显示以更新示例
				}));

		new Setting(containerEl)
			.setName('链接格式')
			.setDesc('选择图片链接的格式')
			.addDropdown(dropdown => dropdown
				.addOption('wiki', 'Wiki 链接 (![[图片]])')
				.addOption('markdown', 'Markdown 链接 (![](图片))')
				.setValue(this.plugin.settings.linkFormat)
				.onChange(async (value) => {
					this.plugin.settings.linkFormat = value;
					await this.plugin.saveSettings();
				}));

		// 示例部分
		const exampleContainer = containerEl.createDiv();
		exampleContainer.createEl('h3', { text: '示例' });
		
		const exampleDesc = exampleContainer.createEl('p', { 
			text: '根据当前设置，生成的文件名示例：' 
		});
		
		const example = exampleContainer.createEl('code', { 
			text: this.generateExample() 
		});
		example.style.display = 'block';
		example.style.marginTop = '10px';
		example.style.padding = '10px';
		example.style.backgroundColor = 'var(--background-secondary)';
		example.style.borderRadius = '4px';
		example.style.fontFamily = 'monospace';
	}

	generateExample() {
		const date = new Date();
		const dateStr = this.plugin.formatDate(date);
		const name = this.plugin.generateNewName(dateStr, this.plugin.settings.startIndex, '.png');
		return name;
	}
}

module.exports = RenameLinkedImagesPlugin;