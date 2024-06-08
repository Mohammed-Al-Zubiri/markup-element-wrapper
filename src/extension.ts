import * as vscode from 'vscode';
import { html as beautifyHtml } from 'js-beautify';

export function activate(context: vscode.ExtensionContext) {

	// Register Code Actions for Main Language (the one that is open first in a workspace)
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const mainLanguage = editor.document.languageId;
		context.subscriptions.push(
			vscode.languages.registerCodeActionsProvider(mainLanguage, new ExtensionActionsProvider(), {
				providedCodeActionKinds: ExtensionActionsProvider.providedCodeActionKinds
			})
		);
	}

	// Register the wrapWithDefault command
  let wrapWithDefaultCommand = vscode.commands.registerCommand('extension.wrapWithDefault', () => {
		let editor = vscode.window.activeTextEditor;
    if (editor) {
			wrapWithElement(editor, false);
    }
	});
	
	context.subscriptions.push(wrapWithDefaultCommand);

	// Register the wrapWithDifferentElement command
  let wrapWithDifferentElementCommand = vscode.commands.registerCommand('extension.wrapWithDifferentElement', () => {
		let editor = vscode.window.activeTextEditor;
    if (editor) {
			wrapWithElement(editor, true);
    }
	});

  context.subscriptions.push(wrapWithDifferentElementCommand);

	// Register the removeElement command
	let removeElementCommand = vscode.commands.registerCommand('extension.removeElement', async () => {
		
    const editor = vscode.window.activeTextEditor;
    if (editor) {
			const userSelection = editor.selection;
			const levelChecker = elementLevelChecker(editor, editor.selection);
			if (isNoSelection(editor) || levelChecker.isNotSameLevel || levelChecker.noOpeningTag) {
				
				let selectedText = await expandSelection(editor);
		
				if (selectedText[0] !== '<') {
					selectedText = await expandSelection(editor);

					// Exit function if selection is not expandable
					if (selectedText[0] !== '<') { return; }
				}

				const config = vscode.workspace.getConfiguration('markup-element-wrapper');
				if (isExcludedElement(config, selectedText)) {
					editor.selection = userSelection;
					return;
				}
				
				// Remove the opening and closing tags from the first level element
				const content = selectedText.replace(/^<[^>]+>|<\/[^>]+>$/g, '');

				const updatedSelection = editor.selection;

				const indentationCount = getEditorIndentationLevel(editor);
				const formattedContent = formatHtml(editor, content, indentationCount);

				await editor.edit(editBuilder => {
					editBuilder.replace(updatedSelection, formattedContent);
				});
				
				unselectText();
			}
    }
  });

  context.subscriptions.push(removeElementCommand);

	// Register the wrapSelection command
	let wrapSelectionCommand = vscode.commands.registerCommand('extension.wrapSelection', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const document = editor.document;
			const userSelection = editor.selection;
			if (isNoSelection(editor)) {return;}

			const selectedText = document.getText(userSelection);
			const expanded = await expandSelection(editor);
			
			// if selected text is not inner text, exit
			if(selectedText === expanded || expanded[0] === '<') { 
				editor.selection = userSelection;
				return;
			}
			
			// wrap the selected text with span then replace it with userSelection
			const newElement = `<span>${selectedText}</span>`;
			editor.selection = userSelection;
			await editor.edit(editBuilder => {
				editBuilder.replace(userSelection, newElement);
			});

			// Change selection to only select TagName span
			let newSelection = editor.selection;
			let start = newSelection.start;		
			start = start.with(start.line, start.character + 1);
			const end = start.with(start.line, start.character + 4);
			newSelection = new vscode.Selection(start, end);
			editor.selection = newSelection;
		}
	});

	context.subscriptions.push(wrapSelectionCommand);
}


class ExtensionActionsProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorRewrite];

  provideCodeActions(): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {

		const codeActions = [
			{command: 'extension.wrapWithDefault', title: 'Wrap with default'},
			{command: 'extension.wrapWithDifferentElement', title: 'Wrap with different element'},
			{command: 'extension.wrapSelection', title: 'Wrap Selection'},
			{command: 'extension.removeElement', title: 'Remove Element from the tree'}
		];

		return codeActions.map(codeAction => {
			const action = new vscode.CodeAction(codeAction.title, vscode.CodeActionKind.RefactorRewrite);
			action.command = codeAction;
			return action;
		});
	}
}

async function wrapWithElement(editor: vscode.TextEditor, isDifferentElement: boolean) {
	const document = editor.document;
		if (editor) {
			const config = vscode.workspace.getConfiguration('markup-element-wrapper');
			const DEFAULT_ELEMENT = config.get('defaultWrappingElement') as string;
			const DEFAULT_CLASS = config.get('defaultClassName') as string;

			let wrappingElement = DEFAULT_ELEMENT ?? 'div';
			const classAttr = ` class="${DEFAULT_CLASS ?? 'wrapper'}"`;
			let selectedText = '';
			let indentLineOne = false;

			if (isDifferentElement) {
				wrappingElement = await vscode.window.showInputBox({ prompt: 'Enter the element name to wrap with' }) ?? '';
			}

			if (wrappingElement === '') {return;}

			const userSelection = editor.selection;
			const levelChecker = elementLevelChecker(editor, userSelection);
			if (isNoSelection(editor) || levelChecker.isNotSameLevel || levelChecker.noOpeningTag) {
				selectedText = await expandSelection(editor);

				// if no selection after expanding, means no markup to be wrapped thus exit function
				if(isNoSelection(editor)) {return;}
		
				if (selectedText[0] !== '<') {
					selectedText = await expandSelection(editor);

					if (selectedText[0] !== '<') { 
						const updatedSelection = await selectLines(editor);
						selectedText = document.getText(updatedSelection);
						indentLineOne = true;
					}
				} else if(!(/<\//.test(selectedText))) {
					editor.selection = userSelection;
					if (isExcludedElement(config, selectedText, true)) {
						return;
					}
					
					const updatedSelection = await selectLines(editor);
					selectedText = document.getText(updatedSelection);
					indentLineOne = true;
				}
			} else {
				const updatedSelection = await selectLines(editor);
				selectedText = document.getText(updatedSelection);
				indentLineOne = true;
			}

			if (isExcludedElement(config, selectedText)) {
				editor.selection = userSelection;
				return;
			}
	
			const newElement = `<${wrappingElement}${classAttr}>\n${selectedText}</${wrappingElement}>`;
			
			const indentationCount = getEditorIndentationLevel(editor);
			const formattedElement = formatHtml(editor, newElement, indentationCount, indentLineOne);
			const updatedSelection = editor.selection;

			await editor.edit(editBuilder => {
				editBuilder.replace(updatedSelection, formattedElement);
			});

			const TAG_NAME_LENGTH = wrappingElement.length;
			const CLASS_NAME_LENGTH = DEFAULT_CLASS.length;
			const SEEK_POSITION = (TAG_NAME_LENGTH + 9) + (indentLineOne? indentationCount: 0);

			// Set selection line and character positions
			const selectionLine = updatedSelection.start.line;	
			const startChar = updatedSelection.start.character + SEEK_POSITION;
			const endChar = updatedSelection.start.character + SEEK_POSITION + CLASS_NAME_LENGTH;

			// Create a new Selection from the start to end Positions
			const selection = new vscode.Selection(new vscode.Position(selectionLine, startChar), new vscode.Position(selectionLine, endChar));

			// Set the editor's selection to highlight the wrapper class
			editor.selection = selection;
		}
}

function isNoSelection(editor: vscode.TextEditor) {
	return editor.selection.start.isEqual(editor.selection.end);
}

function isExcludedElement(config: vscode.WorkspaceConfiguration, markupContent: string, isSelfClosing?: boolean): boolean {
	const excludedTags = 
			isSelfClosing? 
				config.get<string[]>('excludedWrappedSelfClosingElements') : 
				config.get<string[]>('excludedWrappedElements');
	const tagNameMatch = markupContent.match(/<(\w+)/);
	if (tagNameMatch) {
			const tagName = tagNameMatch[1];
			if (excludedTags?.includes(tagName)) {
					return true;
			}
	}
	return false;
}

async function expandSelection(editor: vscode.TextEditor): Promise<string> {
	
	const document = editor.document;
	// Execute the Emmet balance out command to expand the selection
	await vscode.commands.executeCommand('editor.emmet.action.balanceOut');
	
	// Get the updated selection
	const updatedSelection = editor.selection;
	const selectedText = document.getText(updatedSelection);

	return selectedText;
}

function formatHtml(editor: vscode.TextEditor, html: string, indentationLevel: number, indentLineOne?: boolean): string {

	// Convert tabSize to a number
	const tabSize = parseInt(editor.options.tabSize as string, 10);

	// Format the wrappedWord
	const formattedHtml = beautifyHtml(html, { indent_size: tabSize, indent_char: '\t' });

	// Add necessary indentation
	const lines = formattedHtml.split('\n');
	const indentedHtml = lines.map((line, index) => index === 0 && !indentLineOne? line : '\t'.repeat(indentationLevel) + line).join('\n');

	return indentedHtml;
}

function getEditorIndentationLevel(editor: vscode.TextEditor): number {

	const document = editor.document;
	const updatedSelection = editor.selection;
	// Get the line where the selection starts
	const line = document.lineAt(updatedSelection.start.line);
	
	// Determine the indentation level
	const spaceMatch = line.text.match(/^(\s*)/);
	const tabSize = editor.options.tabSize as number;

	let spaceCount = 0;
	if (spaceMatch) {
		for (let char of spaceMatch[0]) {
			if (char === '\t') {
				spaceCount += tabSize;
			} else {
				spaceCount += 1;
			}
		}
	}

	const indentationLevel = Math.floor(spaceCount / tabSize);

	return indentationLevel;
}

async function selectLines(editor: vscode.TextEditor): Promise<vscode.Selection> {

	const editorSelection = editor.selection;
	// Get the start and end lines of the current selection
	const startLine = editorSelection.start.line;
	const endChar = editorSelection.end;

	const newSelection = new vscode.Selection(endChar, endChar);
	editor.selection = newSelection;

	await vscode.commands.executeCommand('editor.emmet.action.balanceOut');

	const endPosition = editor.selection.end;

	// Create a new selection that starts at the beginning of the start line and ends at the end of the end line element
	const updatedSelection = new vscode.Selection(
			new vscode.Position(startLine, 0),
			endPosition
	);

	// Set the editor's selection
	editor.selection = updatedSelection;

	return updatedSelection;
}

function elementLevelChecker(editor: vscode.TextEditor, selection: vscode.Selection): { isNotSameLevel: boolean, noOpeningTag: boolean} {

	const document = editor.document;
	const selectedText = document.getText(selection);

	// Create regular expressions to match '>' not preceded by '</tagName' and '</'
	const openingTagEndRegex = /(?<!<\/\w+)>/g;
	const closingTagStartRegex = /<\/\w*/g;

	// Count the occurrences of '>' not preceded by '</tagName' and '</' (thus counting the opening and closing tags)
	const openingTagEndCount = (selectedText.match(openingTagEndRegex) || []).length;
	const closeTagStartCount = (selectedText.match(closingTagStartRegex) || []).length;

	const isNotSameLevel = openingTagEndCount > closeTagStartCount;
	const noOpeningTag = openingTagEndCount === 0;

	return { isNotSameLevel, noOpeningTag };
}

function unselectText() {
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const selectedText = editor.document.getText(editor.selection);
		const tagNameEnd = selectedText.search(' |>');
		const selectionStart = editor.selection.start; // Get the current position of the cursor
		const position = selectionStart.with(selectionStart.line, selectionStart.character + tagNameEnd);
		const newSelection = new vscode.Selection(position, position);
		editor.selection = newSelection; // Set the new selection
	}
}
