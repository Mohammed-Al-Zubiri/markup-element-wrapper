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
			// initialize arrays to store new selections and new texts
			const newSelections = [] as vscode.Selection[];
			const newTexts = [] as string[];
			// get a copy of the editor selections
			let editorSelections = Array.from(editor.selections);

			// apply removeElement function to each selection in the editor and record the new selection and text
			for (let i = 0; i < editorSelections.length; i++) {
				const newSelection = await removeElement(editor, editorSelections[i]);
				if (newSelection !== undefined) {
					// push the first selection or a selection that does not intersect with the previous selections
					if (i === 0 || newSelections.at(-1)?.intersection(newSelection.selection) === undefined) {
						newSelections.push(newSelection.selection);
						newTexts.push(newSelection.text);
					}
				}
			}

			// set the editor selections to the new selections to replace them with the new text
			// if no new selections, reset the editor selections
			if (newSelections.length === 0) {
				editor.selections = editorSelections;
				return;
			}
			editor.selections = newSelections;

			// Replace the selections text with the new text for all selections
			await editor.edit(editBuilder => {
				for (let i = 0; i < newSelections.length; i++) {
					editBuilder.replace(editor.selections[i], newTexts[i] as string);
				}
			});

			// unselect all selections
			editorSelections = Array.from(editor.selections);
			for (let i = 0; i < editorSelections.length; i++) {
				editorSelections[i] = unselectText(editor, editorSelections[i]);
			}
			editor.selections = editorSelections;
    }
  });

  context.subscriptions.push(removeElementCommand);

	// Register the wrapSelection command
	let wrapSelectionCommand = vscode.commands.registerCommand('extension.wrapSelection', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const newTexts = [] as (string | undefined)[]; // Array to store the new text for each selection
			let editorSelections = Array.from(editor.selections); // Get a copy of the editor selections

			// Wrap each selection in the editor and assign the new text to newTexts
			for(let i = 0; i < editorSelections.length; i++) {
				newTexts.push(await wrapSelection(editor, editorSelections[i]));
			}

			// reset the editor selections
			editor.selections = editorSelections;

			const replacedIndices = [] as number[]; // Array to store the indices of selections that were replaced
			// Replace the selections text in the editor with the new text
			await editor.edit(editBuilder => {
				for (let i = 0; i < newTexts.length; i++) {
					// Replace the text in the selection with new text
					if (newTexts[i] !== undefined) {
						editBuilder.replace(editor.selections[i], newTexts[i] as string);
						replacedIndices.push(i);
					}
				}
			});

			// select opening tag names for all selections
			editorSelections = [];
			for (let i = 0; i < replacedIndices.length; i++) {
				editorSelections.push(selectSpanOpeningTag(editor.selections[replacedIndices[i]].start));
			}
			if (editorSelections.length > 0) {
				editor.selections = editorSelections;
			}
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

async function removeElement(editor: vscode.TextEditor, selection: vscode.Selection): Promise<{selection: vscode.Selection, text: string} | undefined> {
	// Here is the trick to work with each selection individually
	// very important to make sure that the editor.emmet.action.balanceOut is excuted for only the desired selection
	editor.selections = [selection]; // Set the editor selections to only the passed selection

	const levelChecker = elementLevelChecker(editor, selection);
	// Check if no selection OR the selection does not include opening tag OR the selection is not at the same level meaning it is not a complete element
	if (isNoSelection(selection) || levelChecker.isNotSameLevel || levelChecker.noOpeningTag) {
		
		let selectedText = await expandSelection(editor); // Expand the selection to include the whole element

		// check if the selection is stil not an element (first expanding just selected the innerHTML)
		if (selectedText[0] !== '<') {
			selectedText = await expandSelection(editor);

			// Exit function if selection is not expandable by returning undefined
			if (selectedText[0] !== '<') { return; }
		}

		// if the element is excluded from being removed, exit function
		const config = vscode.workspace.getConfiguration('markup-element-wrapper');
		if (isExcludedElement(config, {content: selectedText})) {
			return;
		}
		
		// Remove the opening and closing tags from the element (expanded selection)
		const content = selectedText.replace(/^<[^>]+>|<\/[^>]+>$/g, '');

		// Get the indentation level of the selection to format the content
		const indentationCount = getSelectionIndentationLevel(editor);
		const formattedContent = formatHtml(editor, content, indentationCount);

		// Return the selection to be replaced (expanded selection), and the formatted content as new text to replace the selection
		return {selection: editor.selection, text: formattedContent};
	}
}

async function wrapSelection(editor: vscode.TextEditor, selection: vscode.Selection): Promise<string | undefined> {
	editor.selections = [selection]; // Set the editor selections to only the passed selection
	const document = editor.document;

	if (isNoSelection(selection)) {return;}

	const selectedText = document.getText(selection);
	const expanded = await expandSelection(editor);

	vscode.commands.executeCommand('editor.emmet.action.balanceIn');
	// if no markup or selected text is not inner text, exit
	if(selectedText === expanded || expanded[0] === '<') {
		return;
	}

	// wrap the selected text with span
	const newElement = `<span>${selectedText}</span>`;

	// return newElement string
	return newElement;
}

async function wrapWithElement(editor: vscode.TextEditor, isDifferentElement: boolean) {
	if (editor) {
		// Get default Element tagname and classname from Extension Settings
		const config = vscode.workspace.getConfiguration('markup-element-wrapper');
		const DEFAULT_ELEMENT = config.get('defaultWrappingElement') as string;
		const DEFAULT_CLASS = config.get('defaultClassName') as string;

		let wrappingTagName = DEFAULT_ELEMENT ?? 'div';
		const classAttr = ` class="${DEFAULT_CLASS ?? 'wrapper'}"`;

		// prompt the user to enter different element tagname
		if (isDifferentElement) {
			wrappingTagName = await vscode.window.showInputBox({ prompt: 'Enter the element name to wrap with' }) ?? '';
		}

		if (wrappingTagName === '') {return;}

		const newSelections = [] as vscode.Selection[];
		const newTexts = [] as string[];
		const indents = [];
		let editorSelections = Array.from(editor.selections); // Get a copy of editor selections

		// apply wrapElement function to each selection in the editor and record the new (selection + text + indent info)
		for (let i = 0; i < editorSelections.length; i++) {
			const newSelection = await wrapElement(editor, editorSelections[i], config, {tagName: wrappingTagName, classAttr});
			console.log(newSelection);
			if (newSelection !== undefined) {
				// push the first selection or a selection that does not intersect with the previous selections
				if (i === 0 || newSelections.at(-1)?.intersection(newSelection.selection) === undefined) {
					newSelections.push(newSelection.selection);
					newTexts.push(newSelection.text);
					indents.push(newSelection.indent);
				}
			}
		}

		// set the editor selections to new expanded (ready to be replaced) selections
		// if no new selections, reset the editor selections
		if (newSelections.length === 0) {
			editor.selections = editorSelections;
			return;
		}
		editor.selections = newSelections;

		// Replace the selections text with the new text for all selections
		await editor.edit(editBuilder => {
			for (let i = 0; i < newSelections.length; i++) {
				// Replace the text in the selection with new text
				editBuilder.replace(editor.selections[i], newTexts[i] as string);
			}
		});

		// select wrappingElement classname for all selections
		editorSelections = Array.from(editor.selections); // necessary because editor.selections is readonly but can be reassigned since it is not const
		for (let i = 0; i < editorSelections.length; i++) {
			editorSelections[i] = selectWrappingElementClass(editorSelections[i].start, {tagName: wrappingTagName, DEFAULT_CLASS}, indents[i]);
		}
		editor.selections = editorSelections;
	}
}

async function wrapElement(editor: vscode.TextEditor, selection: vscode.Selection, config: vscode.WorkspaceConfiguration, wrappingElement: any): Promise<any> {

	editor.selections = [selection]; // Set the editor selections to only the passed selection
	const userSelection = new vscode.Selection(selection.start, selection.end); // get a copy of selection before expanding, to reset if expanded selection is less than original (indicating multiple self-closing elements are selected)
	let indentLineOne = false;
	let selectedText = '';

	const levelChecker = elementLevelChecker(editor, selection);
	// Check if no selection OR the selection does not include opening tag OR the selection is not at the same level meaning it is not a complete element
	if (isNoSelection(selection) || levelChecker.isNotSameLevel || levelChecker.noOpeningTag) {
		selectedText = await expandSelection(editor);

		// if no selection after expanding, means no markup to be wrapped thus exit function
		if(isNoSelection(editor.selections[0])) {return;}

		// check if the selection is stil not an element (first expanding just selected the innerHTML)
		if (selectedText[0] !== '<') {
			selectedText = await expandSelection(editor);

			// selection not expandable, try to select lines
			if (selectedText[0] !== '<') { 
				const lines = await selectLines(editor);
				if (lines === undefined) {return;}
				selectedText = lines;
				indentLineOne = true;
			}
		} // check if no closing tag meaning self-closing element is selected
		else if(!(/<\//.test(selectedText))) {
			if (isExcludedElement(config, {content: selectedText}, true)) {
				return;
			}
			editor.selection = userSelection; // reset recorded userSelection to select all lines
			const lines = await selectLines(editor);
			if (lines === undefined) {return;}
			selectedText = lines;
			indentLineOne = true;
		}
	} else {
		// if selection is complete element, select all lines
		const lines = await selectLines(editor);
		if (lines === undefined) {return;}
		selectedText = lines;
		indentLineOne = true;
	}

	// check if element to be wrapped is excluded
	if (isExcludedElement(config, {content: selectedText})) {
		return;
	}

	// wrap selected text with wrapping element + add class attr to openeing tag
	const newElement = `<${wrappingElement.tagName}${wrappingElement.classAttr}>\n${selectedText}</${wrappingElement.tagName}>`;
	
	// get indentation count and format newElement
	const indentationCount = getSelectionIndentationLevel(editor);
	const formattedElement = formatHtml(editor, newElement, indentationCount, indentLineOne);

	// return new selection + text to replace it + indent info
	return {selection: editor.selection, text: formattedElement, indent: {indentLineOne, indentationCount}};
}

function isNoSelection(selection: vscode.Selection) {
	return selection.start.isEqual(selection.end);
}

function isExcludedElement(config: vscode.WorkspaceConfiguration, markup: {content: string}, isSelfClosing?: boolean): boolean {
	const excludedTags = 
			isSelfClosing? 
				config.get<string[]>('excludedWrappedSelfClosingElements') : 
				config.get<string[]>('excludedWrappedElements');
	const tagNameMatch = markup.content.match(/<(\w+)/);
	if (tagNameMatch) {
			const tagName = tagNameMatch[1];
			if (excludedTags?.includes(tagName)) {
					return true;
			}
	}
	return false;
}

async function expandSelection(editor: vscode.TextEditor): Promise<string> {
	// editor.selections = [selection];
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

function getSelectionIndentationLevel(editor: vscode.TextEditor): number {

	const document = editor.document;
	const selection = editor.selection;
	// Get the line where the selection starts
	const line = document.lineAt(selection.start.line);
	
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

async function selectLines(editor: vscode.TextEditor): Promise<string | undefined> {

	const editorSelection = editor.selection;
	// Get the line where the selection starts and check if it is an opening tag
	const startLine = editorSelection.start.line;
	const lineText = editor.document.lineAt(startLine).text;
	if (!(/^\s*<[^\/]/.test(lineText))) {
		return;
	}

	// Expand the selection from the last char and get the end position
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

	return editor.document.getText(updatedSelection);
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

function selectWrappingElementClass(start: vscode.Position, wrappingElement: any, indent: any): vscode.Selection {
	const TAG_NAME_LENGTH = wrappingElement.tagName.length;
	const CLASS_NAME_LENGTH = wrappingElement.DEFAULT_CLASS.length;
	const SEEK_POSITION = (TAG_NAME_LENGTH + 9) + (indent.indentLineOne? indent.indentationCount: 0);

	// Set selection line and character positions
	start = start.with(start.line, start.character + SEEK_POSITION);
	const end = start.with(start.line, start.character + CLASS_NAME_LENGTH);

	// Create a new Selection from the start to end Positions
	const newSelection = new vscode.Selection(start, end);
	
	return newSelection;
}

function selectSpanOpeningTag(start: vscode.Position): vscode.Selection {
	start = start.with(start.line, start.character + 1);
	const end = start.with(start.line, start.character + 4);
	const newSelection = new vscode.Selection(start, end);
	return newSelection;
}

function unselectText(editor: vscode.TextEditor, selection: vscode.Selection): vscode.Selection {
	const selectedText = editor.document.getText(selection);
	if (selectedText[0] !== '<') {
		return new vscode.Selection(selection.end, selection.end);
	}
	const tagNameEnd = selectedText.search(' |>');
	const selectionStart = selection.start; // Get the start position of the selection
	const position = selectionStart.with(selectionStart.line, selectionStart.character + tagNameEnd);
	return new vscode.Selection(position, position);
}
