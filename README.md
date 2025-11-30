# Rename Linked Images 插件修复记录

## 问题描述

插件在多次运行后会出现以下问题：

1. **元数据污染**：文件开头的 YAML 元数据区域的 `url:` 字段会被错误地添加图片链接内容，例如：
   ```markdown
   url:
   ![](zd1130-001.png)))ng)
   ```

2. **前缀不一致**：多次运行插件输入不同前缀时，会导致文章中图片链接前缀不统一（如 `zd1130-` 和 `zwzd1130-` 混用）

3. **重复替换污染**：由于循环多次执行替换操作，已经替换过的内容可能被再次匹配和修改

## 根本原因

`updateContent` 方法中的问题：

```javascript
// 原有问题代码
for (const [oldName, newName] of Object.entries(renameMapping)) {
    // 每次循环都执行一次全局替换
    newContent = newContent.replace(wikiRegex, ...);
    newContent = newContent.replace(markdownRegex, ...);
}
```

- **多次遍历替换**：对每个映射关系都执行一次完整的替换，导致已经替换过的内容可能被后续循环再次匹配
- **正则表达式污染**：循环中构建的正则表达式可能匹配到之前已经替换的内容
- **边界问题**：没有正确处理 YAML 元数据区域的边界，导致误匹配

## 修复方案

重构 `updateContent` 方法，采用**单次遍历替换策略**：

```javascript
updateContent(content, renameMapping) {
    if (Object.keys(renameMapping).length === 0) return content;
    
    // 构建统一的正则表达式，一次性匹配所有需要替换的文件名
    const patterns = Object.keys(renameMapping).map(old => 
        this.escapeRegex(old)
    ).join('|');
    
    // 分别处理 wiki 链接和 markdown 链接
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
    
    return newContent;
}
```

### 关键改进

1. **单次遍历**：构建包含所有待替换文件名的联合正则，一次性完成所有替换
2. **分离处理**：分别处理 wiki 链接（`![[...]]`）和 markdown 链接（`![](...)`）
3. **格式保持**：根据插件设置保持链接格式（wiki 或 markdown）
4. **安全回退**：如果未找到映射关系，保持原内容不变

## 修复效果

- ✅ 不再污染 YAML 元数据区域
- ✅ 避免重复替换导致的链接错乱
- ✅ 统一处理所有图片链接格式
- ✅ 提高替换效率和准确性

## 使用建议

1. 重启 Obsidian 或重新加载插件使修改生效
2. 对于已经污染的文件，手动清理 YAML 元数据区域
3. 运行插件时保持前缀一致，避免混用不同前缀

---

**修复日期**：2025-11-30
**修复版本**：v1.0.1
