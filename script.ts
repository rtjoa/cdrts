// Types and interfaces
interface Tree {
    children: string[];
    value?: string
}

type Edit =
    | { type: 'Insert'; parent: string; new_id: string; value: string }
    | { type: 'Delete'; index: string }

type ParsedEdits =
    | { type: 'Ok'; edits: Edit[]; next_clock: number }
    | { type: 'Error'; message: string }

interface NetworkSettings {
    auto_process: boolean;
    process_delay: number;
}

interface MessageInfo {
    message: Edit[] | Map<string, Tree>;
    startTime: number;
    countdownEl: HTMLDivElement;
}

interface PeerState {
    peer_id: number;
    next_clock: number;
    tree_by_id: Map<string, Tree>;
    root_id: string;
    incoming_messages: MessageInfo[];
    pending_timeouts: number[];  // Store timeout IDs for cleanup
}

interface PeerElements {
    input: HTMLTextAreaElement;
    editor: HTMLDivElement;
    tree: HTMLDivElement;
    incoming: HTMLDivElement;
    error: HTMLDivElement;
}

// Helper functions
const mk_id = (peer_id: number, clock: number): string =>
    `${peer_id}/${clock}`;

const init_state = (peer_id: number): PeerState => ({
    peer_id,
    root_id: mk_id(0, 0),
    tree_by_id: new Map([
        [mk_id(0, 0), { children: [], value: '^' }]
    ]),
    next_clock: 1,
    incoming_messages: [],
    pending_timeouts: [],
});

const escapeSpecialChars = (str: string): string => {
    return str
        .replace(/\\/g, '\\\\')    // Escape backslashes first
        .replace(/\n/g, '\\n')     // Escape newlines
        .replace(/\r/g, '\\r')     // Escape carriage returns
        .replace(/\t/g, '\\t')     // Escape tabs
        .replace(/\f/g, '\\f')     // Escape form feeds
        .replace(/\v/g, '\\v');    // Escape vertical tabs
};

const reprTree = (root_id: string, tree_by_id: Map<string, Tree>, indent: number): string => {
    const root = tree_by_id.get(root_id);
    if (!root) {
        return `${' '.repeat(indent)}${root_id} <Missing>\n`;
    }
    const indentation = ' '.repeat(indent);
    const nodeValue = root.value !== undefined ? escapeSpecialChars(root.value) : '<Tombstone>';
    const result = `${indentation}${root_id} ${nodeValue}\n`;

    return root.children.reduce(
        (acc, child) => acc + reprTree(child, tree_by_id, indent + 1),
        result
    );
};

const treeToString = (root_id: string, tree_by_id: Map<string, Tree>): string => {
    const nodes = preorderTree(root_id, tree_by_id);
    const visibleNodes = nodes.filter(node => !isNodeTombstone(node, tree_by_id))
        .slice(1);  // Remove sentinel node
    return visibleNodes.map(node => tree_by_id.get(node)?.value || '').join('');
};

const preorderTree = (root_id: string, tree_by_id: Map<string, Tree>): string[] => {
    const root = tree_by_id.get(root_id);
    if (!root) return [root_id];
    return root.children.reduce(
        (acc, child) => [...acc, ...preorderTree(child, tree_by_id)],
        [root_id]
    );
};

const reprEdit = (edit: Edit): string => {
    return edit.type === 'Insert'
        ? `after ${edit.parent} ins ${edit.new_id} ${escapeSpecialChars(edit.value)}`
        : `del ${edit.index}`;
};

const isNodeTombstone = (node_id: string, tree_by_id: Map<string, Tree>): boolean => {
    return tree_by_id.get(node_id)?.value === undefined;
};

const compare_ids = (id1: string, id2: string): number => {
    // Sort by decreasing local id (lamport clock), then by increasing peer id
    let [peer_id1, clock1] = id1.split('/');
    let [peer_id2, clock2] = id2.split('/');
    let peer_id1_num = parseInt(peer_id1);
    let peer_id2_num = parseInt(peer_id2);
    let clock1_num = parseInt(clock1);
    let clock2_num = parseInt(clock2);
    if (clock1_num !== clock2_num) {
        return clock2_num - clock1_num;
    }
    return peer_id1_num - peer_id2_num;
}

const mergeEdits = (state: PeerState, edits: Edit[]): void => {
    edits.forEach(edit => {
        if (edit.type === 'Insert') {
            if (state.tree_by_id.has(edit.new_id)) return;

            const parent = state.tree_by_id.get(edit.parent);
            if (!parent) {
                console.error(`Parent node ${edit.parent} not found for insertion of ${edit.new_id}`);
                return;
            }

            const parent_updated = {
                ...parent,
                children: [...parent.children, edit.new_id].sort(compare_ids)
            };

            state.tree_by_id.set(edit.parent, parent_updated);
            state.tree_by_id.set(edit.new_id, {
                children: [],
                value: edit.value,
            });

            state.next_clock = Math.max(state.next_clock, parseInt(edit.new_id.split('/')[1]) + 1);
        } else {
            const to_delete = state.tree_by_id.get(edit.index);
            if (!to_delete) {
                console.error(`Node ${edit.index} not found for deletion`);
                return;
            }

            state.tree_by_id.set(edit.index, {
                children: to_delete.children,
                value: undefined,
            });
        }
    });
}

const combineTrees = (tree: Tree, existing: Tree): Tree => {
    let children = [...new Set([...existing.children, ...tree.children])];
    children.sort(compare_ids);
    let value = undefined;
    if (tree.value !== undefined && existing.value !== undefined) {
        if (tree.value === existing.value) {
            value = tree.value;
        } else {
            value = "<CONFLICT (bug)|" + tree.value + "|" + existing.value + ">";
        }
    }
    return {
        children,
        value,
    };
}

const mergeTree = (state: PeerState, incoming_tree_by_id: Map<string, Tree>): void => {
    incoming_tree_by_id.forEach((tree, id) => {
        state.next_clock = Math.max(state.next_clock, parseInt(id.split('/')[1]) + 1);
        if (!state.tree_by_id.has(id)) {
            state.tree_by_id.set(id, tree);
        } else {
            state.tree_by_id.set(id, combineTrees(tree, state.tree_by_id.get(id) as Tree));
        }
    });
}

class CRDTEditor {
    private peers: Map<number, PeerState>;
    private peer_elements: Map<number, PeerElements>;
    private network_settings: NetworkSettings;
    private auto_process_input: HTMLInputElement;
    private delay_input: HTMLInputElement;
    private treeVisible: boolean = true;
    private incomingVisible: boolean = true;
    private treeToggles: Map<number, HTMLAnchorElement> = new Map();
    private incomingToggles: Map<number, HTMLAnchorElement> = new Map();

    constructor() {
        this.peers = new Map([
            [1, init_state(1)],
            [2, init_state(2)]
        ]);

        this.peer_elements = new Map([
            [1, this.initPeerElements(1)],
            [2, this.initPeerElements(2)]
        ]);

        this.network_settings = {
            auto_process: true,  // Enable by default
            process_delay: 2.0
        };

        this.auto_process_input = document.getElementById('auto-process') as HTMLInputElement;
        this.delay_input = document.getElementById('delay') as HTMLInputElement;

        // Initialize UI with auto-process enabled
        this.auto_process_input.checked = true;
        this.delay_input.disabled = false;

        this.initializeUI();
    }

    private initPeerElements(peer_id: number): PeerElements {
        return {
            input: document.getElementById(`input${peer_id}`) as HTMLTextAreaElement,
            editor: document.getElementById(`editor${peer_id}`) as HTMLDivElement,
            tree: document.getElementById(`tree${peer_id}`) as HTMLDivElement,
            incoming: document.getElementById(`incoming${peer_id}`) as HTMLDivElement,
            error: document.getElementById(`error${peer_id}`) as HTMLDivElement,
        };
    }

    private initializeUI(): void {
        // Add tree toggle buttons
        [1, 2].forEach(peer_id => {
            const treeEl = document.querySelector(`#tree${peer_id}`);
            if (!treeEl) return;

            const treeSection = treeEl.previousElementSibling;
            if (treeSection && treeSection.classList.contains('section-title')) {
                const toggleLink = document.createElement('a');
                toggleLink.href = '#';
                toggleLink.textContent = '(Hide)';
                toggleLink.style.marginLeft = '0.5rem';
                toggleLink.style.fontSize = '0.9em';
                toggleLink.onclick = (e) => {
                    e.preventDefault();
                    this.toggleTreeVisibility(!this.treeVisible);
                };
                treeSection.appendChild(toggleLink);
                this.treeToggles.set(peer_id, toggleLink);
            }

            // Add incoming messages toggle
            const incomingEl = document.querySelector(`#incoming${peer_id}`);
            if (!incomingEl) return;

            const incomingSection = incomingEl.previousElementSibling;
            if (incomingSection && incomingSection.classList.contains('section-title')) {
                const toggleLink = document.createElement('a');
                toggleLink.href = '#';
                toggleLink.textContent = '(Hide)';
                toggleLink.style.marginLeft = '0.5rem';
                toggleLink.style.fontSize = '0.9em';
                toggleLink.onclick = (e) => {
                    e.preventDefault();
                    this.toggleIncomingVisibility(!this.incomingVisible);
                };
                incomingSection.appendChild(toggleLink);
                this.incomingToggles.set(peer_id, toggleLink);
            }
        });

        // Set initial text for Peer 1
        const peer1State = this.peers.get(1) as PeerState;
        const peer1Els = this.peer_elements.get(1) as PeerElements;

        // Add initial text for peer 1
        const initialText = "";
        const initialEdits: Edit[] = [];
        let lastInsertedId = peer1State.root_id;
        initialText.split('').forEach(char => {
            const edit: Edit = {
                type: 'Insert',
                parent: lastInsertedId,
                new_id: mk_id(1, peer1State.next_clock++),
                value: char
            };
            initialEdits.push(edit);
            mergeEdits(peer1State, [edit]);
            lastInsertedId = edit.new_id;
        });
        if (initialEdits.length > 0) {
            this.broadcastEdits(1, initialEdits);
        }

        // Set initial button states and refresh displays
        this.refreshTree(1);
        this.refreshTree(2);
        this.updateButtonStates(1);
        this.updateButtonStates(2);
        this.updateEditorContent(1);
        this.updateEditorContent(2);

        // Add event listeners
        [1, 2].forEach(peer_id => {
            const els = this.peer_elements.get(peer_id) as PeerElements;

            document.getElementById(`send-tree${peer_id}`)?.addEventListener('click', () => this.sendTree(peer_id));

            els.editor.addEventListener('input', (e: Event) => {
                if (e instanceof InputEvent) {
                    this.handleInput(peer_id, e);
                }
            });
            els.editor.addEventListener('keydown', (e) => this.handleKeydown(peer_id, e));
        });

        // Add network settings listeners
        this.auto_process_input.addEventListener('change', () => {
            this.network_settings.auto_process = this.auto_process_input.checked;
            this.delay_input.disabled = !this.network_settings.auto_process;

            if (this.network_settings.auto_process) {
                // Process all existing messages immediately in order
                [1, 2].forEach(peer_id => {
                    const peer = this.peers.get(peer_id) as PeerState;
                    // Process all existing messages in order
                    while (peer.incoming_messages.length > 0) {
                        this.deliverMessage(peer_id, 0);
                        this.dropMessage(peer_id, 0);
                    }
                });
            } else {
                // Clear any pending timeouts when auto-process is disabled
                [1, 2].forEach(peer_id => {
                    const state = this.peers.get(peer_id) as PeerState;
                    state.pending_timeouts.forEach(clearTimeout);
                    state.pending_timeouts = [];
                    // Update UI to show buttons for pending messages
                    this.updateIncomingMessages(peer_id);
                });
            }

            // Update button states for both peers
            [1, 2].forEach(peer_id => this.updateButtonStates(peer_id));
        });

        this.delay_input.addEventListener('change', () => {
            const newDelay = parseFloat(this.delay_input.value);
            if (!isNaN(newDelay) && newDelay >= 0) {
                this.network_settings.process_delay = newDelay;
                document.getElementById('delay-value')!.textContent = `Delay: ${newDelay.toFixed(1)}s`;
            }
        });

        // Also update on input for smoother feedback
        this.delay_input.addEventListener('input', () => {
            const newDelay = parseFloat(this.delay_input.value);
            if (!isNaN(newDelay) && newDelay >= 0) {
                document.getElementById('delay-value')!.textContent = `Delay: ${newDelay.toFixed(1)}s`;
            }
        });
    }

    private findTextDiff(oldText: string, newText: string): { deleteCount: number; insertText: string; startOffset: number } {
        console.log('findTextDiff:', { oldText, newText });

        // Find the first differing character from the start
        let startOffset = 0;
        while (startOffset < oldText.length &&
            startOffset < newText.length &&
            oldText[startOffset] === newText[startOffset]) {
            startOffset++;
        }

        // Find the first differing character from the end
        let oldEndOffset = oldText.length;
        let newEndOffset = newText.length;
        while (oldEndOffset > startOffset &&
            newEndOffset > startOffset &&
            oldText[oldEndOffset - 1] === newText[newEndOffset - 1]) {
            oldEndOffset--;
            newEndOffset--;
        }

        // Special case: if we're just appending text, don't report any deletions
        if (startOffset === oldText.length) {
            const result = {
                startOffset,
                deleteCount: 0,
                insertText: newText.slice(startOffset)
            };
            console.log('findTextDiff result (append):', result);
            return result;
        }

        const result = {
            startOffset,
            deleteCount: oldEndOffset - startOffset,
            insertText: newText.slice(startOffset, newEndOffset)
        };
        console.log('findTextDiff result:', result);
        return result;
    }

    private convertHTMLToText(html: string): string {
        return html
            .replace(/<div><br><\/div>/g, '\n')  // <div><br></div> -> single newline
            .replace(/<div>([^<]*)<\/div>/g, '\n$1')  // <div>text</div> -> \ntext
            .replace(/<div>/g, '\n')  // Any remaining divs -> newline
            .replace(/<\/div>/g, '')  // Remove div closings
            .replace(/<br>/g, '\n')   // <br> -> newline
            || '';
    }

    private handleInput(peer_id: number, event: InputEvent): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;

        // For paste events, use the clipboard data if available
        if (event.inputType === 'insertFromPaste') {
            // Let the browser handle the paste first
            setTimeout(() => {
                // Get the text content with correct newlines
                const newText = this.convertHTMLToText(els.editor.innerHTML);
                const oldText = treeToString(state.root_id, state.tree_by_id);
                console.log('paste:', {
                    oldText: JSON.stringify(oldText),
                    newText: JSON.stringify(newText),
                    innerHTML: els.editor.innerHTML
                });

                const diff = this.findTextDiff(oldText, newText);
                const edits: Edit[] = [];

                // Handle deletions
                if (diff.deleteCount > 0) {
                    const nodes = preorderTree(state.root_id, state.tree_by_id);
                    const visibleNodes = nodes.filter(node => !isNodeTombstone(node, state.tree_by_id))
                        .slice(1);  // Remove sentinel from visible nodes
                    const nodesToDelete = visibleNodes.slice(diff.startOffset, diff.startOffset + diff.deleteCount);

                    nodesToDelete.forEach(node => {
                        edits.push({
                            type: 'Delete' as const,
                            index: node
                        });
                    });

                    mergeEdits(state, edits);
                }

                // Handle insertions
                if (diff.insertText) {
                    const nodes = preorderTree(state.root_id, state.tree_by_id);
                    const visibleNodes = nodes.filter(node => !isNodeTombstone(node, state.tree_by_id))
                        .slice(1);  // Remove sentinel from visible nodes

                    // Find parent node for insertion
                    const parent = diff.startOffset === 0 ? state.root_id : visibleNodes[diff.startOffset - 1];

                    // Insert each character
                    let lastInsertedId = parent;
                    diff.insertText.split('').forEach(char => {
                        const insertEdit: Edit = {
                            type: 'Insert',
                            parent: lastInsertedId,
                            new_id: mk_id(state.peer_id, state.next_clock++),
                            value: char
                        };
                        edits.push(insertEdit);
                        mergeEdits(state, [insertEdit]);
                        lastInsertedId = insertEdit.new_id;
                    });
                }

                if (edits.length > 0) {
                    this.broadcastEdits(peer_id, edits);
                    this.refreshTree(peer_id);
                }
            }, 0);
            return;
        }

        // Handle all other input types
        const newText = this.convertHTMLToText(els.editor.innerHTML);
        const oldText = treeToString(state.root_id, state.tree_by_id);
        console.log('handleInput:', {
            type: event.inputType,
            data: event.data,
            oldText: JSON.stringify(oldText),
            newText: JSON.stringify(newText),
            oldLen: oldText.length,
            newLen: newText.length,
            oldTextArray: [...oldText].map(c => c.charCodeAt(0)),
            newTextArray: [...newText].map(c => c.charCodeAt(0)),
            innerHTML: els.editor.innerHTML
        });

        // Special case for Enter key (insertParagraph)
        if (event.inputType === 'insertParagraph') {
            // Get current text and find insertion point at the end
            const text = treeToString(state.root_id, state.tree_by_id);
            const insertPos = text.length;

            // Get visible nodes for parent selection
            const nodes = preorderTree(state.root_id, state.tree_by_id);
            const visibleNodes = nodes.filter(node => !isNodeTombstone(node, state.tree_by_id))
                .slice(1);  // Remove sentinel from visible nodes

            // Find parent node for insertion
            const parent = insertPos === 0 ? state.root_id : visibleNodes[insertPos - 1];

            // Insert newline
            const insertEdit: Edit = {
                type: 'Insert',
                parent,
                new_id: mk_id(state.peer_id, state.next_clock++),
                value: '\n'
            };
            mergeEdits(state, [insertEdit]);
            this.broadcastEdits(peer_id, [insertEdit]);
            this.refreshTree(peer_id);
            return;
        }

        const diff = this.findTextDiff(oldText, newText);
        console.log('diff:', diff);

        const edits: Edit[] = [];

        // Handle deletions
        if (diff.deleteCount > 0) {
            const nodes = preorderTree(state.root_id, state.tree_by_id);
            const visibleNodes = nodes.filter(node => !isNodeTombstone(node, state.tree_by_id))
                .slice(1);  // Remove sentinel from visible nodes
            const nodesToDelete = visibleNodes.slice(diff.startOffset, diff.startOffset + diff.deleteCount);

            nodesToDelete.forEach(node => {
                edits.push({
                    type: 'Delete' as const,
                    index: node
                });
            });

            mergeEdits(state, edits);
        }

        // Handle insertions
        if (diff.insertText) {
            const nodes = preorderTree(state.root_id, state.tree_by_id);
            const visibleNodes = nodes.filter(node => !isNodeTombstone(node, state.tree_by_id))
                .slice(1);  // Remove sentinel from visible nodes

            // Find parent node for insertion
            const parent = diff.startOffset === 0 ? state.root_id : visibleNodes[diff.startOffset - 1];

            // Insert each character
            let lastInsertedId = parent;
            diff.insertText.split('').forEach(char => {
                const insertEdit: Edit = {
                    type: 'Insert',
                    parent: lastInsertedId,
                    new_id: mk_id(state.peer_id, state.next_clock++),
                    value: char
                };
                edits.push(insertEdit);
                mergeEdits(state, [insertEdit]);
                lastInsertedId = insertEdit.new_id;
            });
        }

        if (edits.length > 0) {
            this.broadcastEdits(peer_id, edits);
            this.refreshTree(peer_id);
        }
    }

    private handleKeydown(peer_id: number, event: KeyboardEvent): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;

        // Handle special keys
        if (event.key === 'Tab') {
            event.preventDefault();
            // Insert tab character
            const insertEdit: Edit = {
                type: 'Insert',
                parent: state.root_id,
                new_id: mk_id(state.peer_id, state.next_clock++),
                value: '\t'
            };
            mergeEdits(state, [insertEdit]);
            this.broadcastEdits(peer_id, [insertEdit]);
            this.refreshTree(peer_id);
            this.updateEditorContent(peer_id);
        }
    }

    private saveSelection(editor: HTMLDivElement): { start: number; end: number; text: string } | null {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return null;

        const range = selection.getRangeAt(0);
        if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;

        return {
            start: range.startOffset,
            end: range.endOffset,
            text: editor.textContent || ''  // Save text at time of selection
        };
    }

    private transformPosition(pos: number, oldText: string, newText: string): number {
        // If position is at the end, keep it at the end
        if (pos >= oldText.length) return newText.length;

        // Find common prefix length
        let prefixLen = 0;
        while (prefixLen < pos &&
            prefixLen < oldText.length &&
            prefixLen < newText.length &&
            oldText[prefixLen] === newText[prefixLen]) {
            prefixLen++;
        }

        // If position is in unchanged prefix, keep it the same
        if (pos <= prefixLen) return pos;

        // If text was deleted before position, adjust backwards
        if (newText.length < oldText.length) {
            return Math.min(pos, newText.length);
        }

        // If text was inserted before position, adjust forwards
        return Math.min(pos + (newText.length - oldText.length), newText.length);
    }

    private restoreSelection(editor: HTMLDivElement, savedSelection: { start: number; end: number; text: string } | null): void {
        if (!savedSelection) return;

        const selection = window.getSelection();
        if (!selection) return;

        const newText = editor.textContent || '';

        // Transform selection positions based on text changes
        const newStart = this.transformPosition(savedSelection.start, savedSelection.text, newText);
        const newEnd = this.transformPosition(savedSelection.end, savedSelection.text, newText);

        const range = document.createRange();
        range.setStart(editor.firstChild || editor, newStart);
        range.setEnd(editor.firstChild || editor, newEnd);

        selection.removeAllRanges();
        selection.addRange(range);
    }

    private updateEditorContent(peer_id: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;

        // Save current selection
        const savedSelection = this.saveSelection(els.editor);

        // Get text from tree, excluding sentinel
        const text = treeToString(state.root_id, state.tree_by_id);
        els.editor.innerHTML = text.replace(/\n/g, '<br>');
        els.input.value = text;  // Keep hidden textarea in sync

        // Restore selection
        this.restoreSelection(els.editor, savedSelection);
    }

    private refreshTree(peer_id: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;
        els.tree.textContent = reprTree(state.root_id, state.tree_by_id, 0);
    }

    private sendTree(peer_id: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        let copied_tree_by_id = new Map(state.tree_by_id);
        this.broadcastEdits(peer_id, copied_tree_by_id);
    }

    private broadcastEdits(sender_id: number, message: Edit[] | Map<string, Tree>): void {
        [1, 2].forEach(peer_id => {
            if (peer_id !== sender_id) {
                const peer = this.peers.get(peer_id) as PeerState;
                const startTime = Date.now();
                const messageInfo: MessageInfo = {
                    message,
                    startTime,
                    countdownEl: document.createElement('div')
                };
                peer.incoming_messages.push(messageInfo);
                this.updateIncomingMessages(peer_id);

                // If auto-process is enabled, schedule processing
                if (this.network_settings.auto_process) {
                    const timeoutId = window.setTimeout(() => {
                        // Find the first unprocessed message
                        const messageIndex = peer.incoming_messages.findIndex(m => m.message === message);
                        if (messageIndex >= 0) {
                            this.deliverMessage(peer_id, messageIndex);
                            this.dropMessage(peer_id, messageIndex);
                        }
                        // Remove the timeout ID from pending_timeouts
                        peer.pending_timeouts = peer.pending_timeouts.filter(id => id !== timeoutId);
                    }, this.network_settings.process_delay * 1000);

                    // Start countdown animation
                    const updateCountdown = () => {
                        const messageIndex = peer.incoming_messages.findIndex(m => m.message === message);
                        if (messageIndex >= 0) {
                            const messageInfo = peer.incoming_messages[messageIndex];
                            const elapsed = (Date.now() - messageInfo.startTime) / 1000;
                            const progress = Math.min(1, elapsed / this.network_settings.process_delay) * 100;
                            messageInfo.countdownEl.style.background =
                                `conic-gradient(var(--primary-color) ${progress}%, #e5e7eb ${progress}%)`;

                            if (progress < 100) {
                                requestAnimationFrame(updateCountdown);
                            }
                        }
                    };
                    requestAnimationFrame(updateCountdown);

                    peer.pending_timeouts.push(timeoutId);
                }
            }
        });
    }

    private updateUI(state: PeerState, els: PeerElements): void {
        this.updateEditorContent(state.peer_id);
        els.tree.textContent = reprTree(state.root_id, state.tree_by_id, 0);
        this.updateButtonStates(state.peer_id);
    }

    private updateIncomingMessages(peer_id: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;
        const incomingSection = document.getElementById(`incoming-section${peer_id}`);

        // Clear existing messages
        els.incoming.innerHTML = '';

        // Add messages if there are any
        if (state.incoming_messages.length > 0) {
            els.incoming.classList.add('has-messages');
            state.incoming_messages.forEach((messageInfo, index) => {
                const messageEl = this.createMessageElement(messageInfo.message, peer_id, index);
                const countdownEl = messageEl.querySelector('.countdown') as HTMLDivElement;
                messageInfo.countdownEl = countdownEl;
                // Update countdown visibility based on auto-process state
                countdownEl.style.display = this.network_settings.auto_process ? 'block' : 'none';
                els.incoming.appendChild(messageEl);
            });
        } else {
            els.incoming.classList.remove('has-messages');
        }

        // Apply current visibility state
        els.incoming.style.display = this.incomingVisible ? '' : 'none';
    }

    private createMessageElement(message: Edit[] | Map<string, Tree>, peer_id: number, index: number): HTMLDivElement {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-container';

        const messageText = document.createElement('pre');
        messageText.className = 'message-text';
        if (message instanceof Map) {
            let state = this.peers.get(peer_id) as PeerState;
            messageText.textContent = reprTree(state.root_id, message, 0);
        } else {
            messageText.textContent = message.map(edit => reprEdit(edit)).join('\n');
        }

        const countdownEl = document.createElement('div');
        countdownEl.className = 'countdown';
        countdownEl.style.display = this.network_settings.auto_process ? 'block' : 'none';

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'button-group';

        const deliverButton = document.createElement('button');
        deliverButton.textContent = 'Process';
        deliverButton.onclick = () => this.deliverMessage(peer_id, index);
        deliverButton.disabled = this.network_settings.auto_process;

        const dropButton = document.createElement('button');
        dropButton.textContent = 'Drop';
        dropButton.onclick = () => this.dropMessage(peer_id, index);
        dropButton.disabled = this.network_settings.auto_process;

        buttonGroup.append(deliverButton, dropButton);
        messageDiv.append(messageText, countdownEl, buttonGroup);

        // Update message text margin based on auto-process state
        messageText.style.marginRight = this.network_settings.auto_process ? '2rem' : '16rem';

        return messageDiv;
    }

    private deliverMessage(peer_id: number, message_index: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;

        const messageInfo = state.incoming_messages[message_index];
        if (messageInfo.message instanceof Map) {
            mergeTree(state, messageInfo.message);
        } else {
            mergeEdits(state, messageInfo.message);
        }
        this.updateUI(state, els);
    }

    private dropMessage(peer_id: number, message_index: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        state.incoming_messages = [
            ...state.incoming_messages.slice(0, message_index),
            ...state.incoming_messages.slice(message_index + 1)
        ];
        this.updateIncomingMessages(peer_id);
    }

    private parseEdits(state: PeerState, text_with_edits: string): ParsedEdits {
        if (text_with_edits[0] !== '^') {
            return { type: 'Error', message: "Invalid edit: Document must start with '^'" };
        }

        const nodes = preorderTree(state.root_id, state.tree_by_id);
        let non_tombstone_node_ids = [nodes[0]]; // stack to delete
        let text_i = 1;
        let node_i = 1;

        let next_clock = state.next_clock;
        const edits: Edit[] = [];

        while (text_i < text_with_edits.length) {
            const result = this.parseEditToken(
                text_with_edits, text_i, node_i,
                state, nodes, non_tombstone_node_ids, next_clock
            );

            if (result.error) {
                return { type: 'Error', message: result.error };
            }

            if (result.edit) edits.push(result.edit);
            text_i = result.text_i;
            node_i = result.node_i;
            next_clock = result.next_clock;
            non_tombstone_node_ids = result.non_tombstone_node_ids;
        }

        // Check for remaining non-tombstone nodes
        while (node_i < nodes.length &&
            isNodeTombstone(nodes[node_i], state.tree_by_id)) {
            node_i++;
        }

        if (node_i < nodes.length) {
            return { type: 'Error', message: "Error: tree char but no text char." };
        }

        return { type: 'Ok', edits, next_clock };
    }

    private parseEditToken(
        text: string,
        text_i: number,
        node_i: number,
        state: PeerState,
        nodes: string[],
        non_tombstone_node_ids: string[],
        next_clock: number
    ): {
        text_i: number;
        node_i: number;
        next_clock: number;
        non_tombstone_node_ids: string[];
        edit?: Edit;
        error?: string;
    } {
        const char = text[text_i];

        if (char === '-') {
            const nodeToDelete = non_tombstone_node_ids[non_tombstone_node_ids.length - 1];
            if (nodeToDelete === state.root_id) {
                return {
                    error: "Invalid edit: Cannot delete the root node (^)",
                    text_i, node_i, next_clock, non_tombstone_node_ids
                };
            }

            return {
                text_i: text_i + 1,
                node_i,
                next_clock,
                non_tombstone_node_ids: non_tombstone_node_ids.slice(0, -1),
                edit: {
                    type: 'Delete',
                    index: nodeToDelete
                }
            };
        }

        if (char === '+') {
            if (text_i + 1 >= text.length) {
                return {
                    error: "Invalid edit: '+' must be followed by a character to insert",
                    text_i, node_i, next_clock, non_tombstone_node_ids
                };
            }

            const charToInsert = text[text_i + 1];
            if (charToInsert === '+' || charToInsert === '-') {
                return {
                    error: `Invalid edit: Cannot insert special characters '+' or '-'`,
                    text_i, node_i, next_clock, non_tombstone_node_ids
                };
            }

            const new_id = mk_id(state.peer_id, next_clock);
            return {
                text_i: text_i + 2,
                node_i,
                next_clock: next_clock + 1,
                non_tombstone_node_ids: [...non_tombstone_node_ids, new_id],
                edit: {
                    type: 'Insert',
                    parent: non_tombstone_node_ids[non_tombstone_node_ids.length - 1],
                    new_id,
                    value: charToInsert
                }
            };
        }

        while (node_i < nodes.length && isNodeTombstone(nodes[node_i], state.tree_by_id)) {
            node_i++;
        }

        if (node_i >= nodes.length) {
            return {
                error: "Invalid edit: Too many characters. The edit would make the text longer than the current tree structure.",
                text_i, node_i, next_clock, non_tombstone_node_ids
            };
        }

        const node = state.tree_by_id.get(nodes[node_i]) as Tree;
        if (text[text_i] !== node.value) {
            return {
                error: `Invalid edit: Expected '${node.value}' but found '${text[text_i]}'. Edits must match existing characters unless using '+' or '-'.`,
                text_i, node_i, next_clock, non_tombstone_node_ids
            };
        }

        return {
            text_i: text_i + 1,
            node_i: node_i + 1,
            next_clock,
            non_tombstone_node_ids: [...non_tombstone_node_ids, nodes[node_i]]
        };
    }

    private hasEdits(peer_id: number): boolean {
        const state = this.peers.get(peer_id) as PeerState;
        const input = document.getElementById(`input${peer_id}`) as HTMLTextAreaElement;
        const treeContent = treeToString(state.root_id, state.tree_by_id).slice(1); // slice(1) removes the '^'
        return input.value !== treeContent;
    }

    private hasTreeChanges(state: PeerState): boolean {
        // Check if tree has more than just the root sentinel node
        return state.tree_by_id.size > 1;
    }

    private updateButtonStates(peer_id: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const sendTreeButton = document.getElementById(`send-tree${peer_id}`) as HTMLButtonElement;

        // Disable send tree button if there are no changes or only root node, or if auto-process is on
        sendTreeButton.disabled = !this.hasTreeChanges(state) || this.network_settings.auto_process;

        // Update button tooltips for better UX
        sendTreeButton.title = this.network_settings.auto_process ? 'Disabled during auto-process' :
            (sendTreeButton.disabled ? 'No tree changes to send' : 'Send tree state');
    }

    private toggleTreeVisibility(visible: boolean): void {
        this.treeVisible = visible;
        [1, 2].forEach(peer_id => {
            const els = this.peer_elements.get(peer_id) as PeerElements;
            const toggle = this.treeToggles.get(peer_id);
            if (toggle) {
                if (visible) {
                    els.tree.style.display = '';
                    toggle.textContent = '(Hide)';
                } else {
                    els.tree.style.display = 'none';
                    toggle.textContent = '(Show)';
                }
            }
        });
    }

    private toggleIncomingVisibility(visible: boolean): void {
        this.incomingVisible = visible;
        [1, 2].forEach(peer_id => {
            const els = this.peer_elements.get(peer_id) as PeerElements;
            const toggle = this.incomingToggles.get(peer_id);
            if (toggle) {
                if (visible) {
                    els.incoming.style.display = '';
                    toggle.textContent = '(Hide)';
                } else {
                    els.incoming.style.display = 'none';
                    toggle.textContent = '(Show)';
                }
            }
        });
    }
}

// Initialize the application when the window loads
window.onload = () => {
    new CRDTEditor();
};