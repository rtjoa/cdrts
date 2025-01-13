"use strict";
// Helper functions
const mk_id = (peer_id, clock) => `${peer_id}/${clock}`;
const init_state = (peer_id) => ({
    peer_id,
    root_id: mk_id(0, 0),
    tree_by_id: new Map([
        [mk_id(0, 0), { children: [], value: '^' }]
    ]),
    next_clock: 1,
    incoming_messages: [],
    cursor_node: mk_id(0, 0), // Start cursor at root
    pending_timeouts: [],
});
const escapeSpecialChars = (str) => {
    return str
        .replace(/\\/g, '\\\\') // Escape backslashes first
        .replace(/\n/g, '\\n') // Escape newlines
        .replace(/\r/g, '\\r') // Escape carriage returns
        .replace(/\t/g, '\\t') // Escape tabs
        .replace(/\f/g, '\\f') // Escape form feeds
        .replace(/\v/g, '\\v'); // Escape vertical tabs
};
const reprTree = (root_id, tree_by_id, indent) => {
    const root = tree_by_id.get(root_id);
    if (!root) {
        return `${' '.repeat(indent)}${root_id} <Missing>\n`;
    }
    const indentation = '  '.repeat(indent);
    const nodeValue = root.value !== undefined ? escapeSpecialChars(root.value) : '<Tombstone>';
    const result = `${indentation}${root_id} ${nodeValue}\n`;
    return root.children.reduce((acc, child) => acc + reprTree(child, tree_by_id, indent + 1), result);
};
const treeToString = (root_id, tree_by_id) => {
    var _a;
    const root = tree_by_id.get(root_id);
    if (!root)
        return '';
    const value = (_a = root.value) !== null && _a !== void 0 ? _a : '';
    return root.children.reduce((acc, child) => acc + treeToString(child, tree_by_id), value);
};
const preorderTree = (root_id, tree_by_id) => {
    const root = tree_by_id.get(root_id);
    if (!root)
        return [root_id];
    return root.children.reduce((acc, child) => [...acc, ...preorderTree(child, tree_by_id)], [root_id]);
};
const reprEdit = (edit) => {
    return edit.type === 'Insert'
        ? `after ${edit.parent} ins ${edit.new_id} ${escapeSpecialChars(edit.value)}`
        : `del ${edit.index}`;
};
const isNodeTombstone = (node_id, tree_by_id) => {
    var _a;
    return ((_a = tree_by_id.get(node_id)) === null || _a === void 0 ? void 0 : _a.value) === undefined;
};
const compare_ids = (id1, id2) => {
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
};
const mergeEdits = (state, edits) => {
    edits.forEach(edit => {
        if (edit.type === 'Insert') {
            if (state.tree_by_id.has(edit.new_id))
                return;
            const parent = state.tree_by_id.get(edit.parent);
            if (!parent) {
                console.error(`Parent node ${edit.parent} not found for insertion of ${edit.new_id}`);
                return;
            }
            const parent_updated = Object.assign(Object.assign({}, parent), { children: [...parent.children, edit.new_id].sort(compare_ids) });
            state.tree_by_id.set(edit.parent, parent_updated);
            state.tree_by_id.set(edit.new_id, {
                children: [],
                value: edit.value,
            });
            state.next_clock = Math.max(state.next_clock, parseInt(edit.new_id.split('/')[1]) + 1);
        }
        else {
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
};
const combineTrees = (tree, existing) => {
    let children = [...new Set([...existing.children, ...tree.children])];
    children.sort(compare_ids);
    let value = undefined;
    if (tree.value !== undefined && existing.value !== undefined) {
        if (tree.value === existing.value) {
            value = tree.value;
        }
        else {
            value = "<CONFLICT (bug)|" + tree.value + "|" + existing.value + ">";
        }
    }
    return {
        children,
        value,
    };
};
const mergeTree = (state, incoming_tree_by_id) => {
    incoming_tree_by_id.forEach((tree, id) => {
        state.next_clock = Math.max(state.next_clock, parseInt(id.split('/')[1]) + 1);
        if (!state.tree_by_id.has(id)) {
            state.tree_by_id.set(id, tree);
        }
        else {
            state.tree_by_id.set(id, combineTrees(tree, state.tree_by_id.get(id)));
        }
    });
};
class CRDTEditor {
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
            auto_process: false,
            process_delay: 1.0
        };
        this.auto_process_input = document.getElementById('auto-process');
        this.delay_input = document.getElementById('delay');
        this.initializeUI();
    }
    initPeerElements(peer_id) {
        return {
            input: document.getElementById(`input${peer_id}`),
            editor: document.getElementById(`editor${peer_id}`),
            tree: document.getElementById(`tree${peer_id}`),
            incoming: document.getElementById(`incoming${peer_id}`),
            error: document.getElementById(`error${peer_id}`),
        };
    }
    initializeUI() {
        // Set initial text for Peer 1
        const peer1State = this.peers.get(1);
        const peer1Els = this.peer_elements.get(1);
        // Add initial text for peer 1
        const initialText = "";
        const initialEdits = [];
        initialText.split('').forEach(char => {
            const edit = {
                type: 'Insert',
                parent: peer1State.cursor_node,
                new_id: mk_id(1, peer1State.next_clock++),
                value: char
            };
            initialEdits.push(edit);
            mergeEdits(peer1State, [edit]);
            peer1State.cursor_node = edit.new_id;
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
            var _a;
            const els = this.peer_elements.get(peer_id);
            (_a = document.getElementById(`send-tree${peer_id}`)) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => this.sendTree(peer_id));
            els.editor.addEventListener('input', (e) => {
                if (e instanceof InputEvent) {
                    this.handleInput(peer_id, e);
                }
            });
            els.editor.addEventListener('keydown', (e) => this.handleKeydown(peer_id, e));
            els.editor.addEventListener('click', () => this.updateCursorFromSelection(peer_id));
        });
        // Add network settings listeners
        this.auto_process_input.addEventListener('change', () => {
            this.network_settings.auto_process = this.auto_process_input.checked;
            this.delay_input.disabled = !this.network_settings.auto_process;
            // Clear any pending timeouts when auto-process is disabled
            if (!this.network_settings.auto_process) {
                [1, 2].forEach(peer_id => {
                    const state = this.peers.get(peer_id);
                    state.pending_timeouts.forEach(clearTimeout);
                    state.pending_timeouts = [];
                });
            }
        });
        this.delay_input.addEventListener('change', () => {
            const newDelay = parseFloat(this.delay_input.value);
            if (!isNaN(newDelay) && newDelay >= 0) {
                this.network_settings.process_delay = newDelay;
            }
        });
    }
    handleInput(peer_id, event) {
        const state = this.peers.get(peer_id);
        const els = this.peer_elements.get(peer_id);
        // Handle text input
        if (event.inputType === 'insertText' && event.data) {
            const edit = {
                type: 'Insert',
                parent: state.cursor_node,
                new_id: mk_id(state.peer_id, state.next_clock++),
                value: event.data
            };
            mergeEdits(state, [edit]);
            state.cursor_node = edit.new_id;
            this.broadcastEdits(peer_id, [edit]);
            this.updateUI(state, els);
            this.updateEditorContent(peer_id);
            this.setCaretPosition(peer_id);
        }
        // Handle deletion
        else if (event.inputType === 'deleteContentBackward') {
            if (state.cursor_node === state.root_id)
                return;
            const edit = {
                type: 'Delete',
                index: state.cursor_node
            };
            // Update cursor to previous node
            const nodes = preorderTree(state.root_id, state.tree_by_id);
            const currentIndex = nodes.indexOf(state.cursor_node);
            if (currentIndex > 0) {
                let prevIndex = currentIndex - 1;
                while (prevIndex > 0 && isNodeTombstone(nodes[prevIndex], state.tree_by_id)) {
                    prevIndex--;
                }
                state.cursor_node = nodes[prevIndex];
            }
            mergeEdits(state, [edit]);
            this.broadcastEdits(peer_id, [edit]);
            this.updateUI(state, els);
            this.updateEditorContent(peer_id);
            this.setCaretPosition(peer_id);
        }
    }
    handleKeydown(peer_id, event) {
        const state = this.peers.get(peer_id);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const nodes = preorderTree(state.root_id, state.tree_by_id);
            const currentIndex = nodes.indexOf(state.cursor_node);
            if (event.key === 'ArrowLeft' && currentIndex > 0) {
                let prevIndex = currentIndex - 1;
                while (prevIndex > 0 && isNodeTombstone(nodes[prevIndex], state.tree_by_id)) {
                    prevIndex--;
                }
                state.cursor_node = nodes[prevIndex];
            }
            else if (event.key === 'ArrowRight' && currentIndex < nodes.length - 1) {
                let nextIndex = currentIndex + 1;
                while (nextIndex < nodes.length && isNodeTombstone(nodes[nextIndex], state.tree_by_id)) {
                    nextIndex++;
                }
                if (nextIndex < nodes.length) {
                    state.cursor_node = nodes[nextIndex];
                }
            }
            this.setCaretPosition(peer_id);
        }
    }
    updateCursorFromSelection(peer_id) {
        const state = this.peers.get(peer_id);
        const els = this.peer_elements.get(peer_id);
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount)
            return;
        const range = selection.getRangeAt(0);
        const offset = range.startOffset;
        // Find the node at the cursor position
        const nodes = preorderTree(state.root_id, state.tree_by_id);
        let charCount = 0;
        for (const node_id of nodes) {
            if (!isNodeTombstone(node_id, state.tree_by_id)) {
                if (charCount === offset) {
                    state.cursor_node = node_id;
                    break;
                }
                charCount++;
            }
        }
    }
    updateEditorContent(peer_id) {
        const state = this.peers.get(peer_id);
        const els = this.peer_elements.get(peer_id);
        els.editor.textContent = treeToString(state.root_id, state.tree_by_id).slice(1);
        els.input.value = els.editor.textContent; // Keep hidden textarea in sync
    }
    setCaretPosition(peer_id) {
        const state = this.peers.get(peer_id);
        const els = this.peer_elements.get(peer_id);
        const nodes = preorderTree(state.root_id, state.tree_by_id);
        let offset = 0;
        for (const node_id of nodes) {
            if (node_id === state.cursor_node)
                break;
            if (!isNodeTombstone(node_id, state.tree_by_id)) {
                offset++;
            }
        }
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(els.editor.firstChild || els.editor, offset);
        range.collapse(true);
        sel === null || sel === void 0 ? void 0 : sel.removeAllRanges();
        sel === null || sel === void 0 ? void 0 : sel.addRange(range);
        els.editor.focus();
    }
    refreshTree(peer_id) {
        const state = this.peers.get(peer_id);
        const els = this.peer_elements.get(peer_id);
        els.tree.textContent = reprTree(state.root_id, state.tree_by_id, 0);
    }
    sendTree(peer_id) {
        const state = this.peers.get(peer_id);
        let copied_tree_by_id = new Map(state.tree_by_id);
        this.broadcastEdits(peer_id, copied_tree_by_id);
    }
    broadcastEdits(sender_id, message) {
        [1, 2].forEach(peer_id => {
            if (peer_id !== sender_id) {
                const peer = this.peers.get(peer_id);
                peer.incoming_messages.push(message);
                this.updateIncomingMessages(peer_id);
                // If auto-process is enabled, schedule processing
                if (this.network_settings.auto_process) {
                    const timeoutId = window.setTimeout(() => {
                        // Find the first unprocessed message
                        const messageIndex = peer.incoming_messages.findIndex(m => m === message);
                        if (messageIndex >= 0) {
                            this.deliverMessage(peer_id, messageIndex);
                            this.dropMessage(peer_id, messageIndex);
                        }
                        // Remove the timeout ID from pending_timeouts
                        peer.pending_timeouts = peer.pending_timeouts.filter(id => id !== timeoutId);
                    }, this.network_settings.process_delay * 1000);
                    peer.pending_timeouts.push(timeoutId);
                }
            }
        });
    }
    updateUI(state, els) {
        this.updateEditorContent(state.peer_id);
        els.tree.textContent = reprTree(state.root_id, state.tree_by_id, 0);
        this.updateButtonStates(state.peer_id);
    }
    updateIncomingMessages(peer_id) {
        const state = this.peers.get(peer_id);
        const els = this.peer_elements.get(peer_id);
        const incomingSection = document.getElementById(`incoming-section${peer_id}`);
        if (state.incoming_messages.length === 0) {
            incomingSection === null || incomingSection === void 0 ? void 0 : incomingSection.classList.remove('has-messages');
            return;
        }
        incomingSection === null || incomingSection === void 0 ? void 0 : incomingSection.classList.add('has-messages');
        els.incoming.innerHTML = '';
        state.incoming_messages.forEach((message, index) => {
            const messageEl = this.createMessageElement(message, peer_id, index);
            els.incoming.appendChild(messageEl);
        });
    }
    createMessageElement(message, peer_id, index) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-container';
        const messageText = document.createElement('pre');
        messageText.className = 'message-text';
        if (message instanceof Map) {
            let state = this.peers.get(peer_id);
            messageText.textContent = reprTree(state.root_id, message, 0);
        }
        else {
            messageText.textContent = message.map(edit => reprEdit(edit)).join('\n');
        }
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'button-group';
        const deliverButton = document.createElement('button');
        deliverButton.textContent = 'Process';
        deliverButton.onclick = () => this.deliverMessage(peer_id, index);
        const dropButton = document.createElement('button');
        dropButton.textContent = 'Drop';
        dropButton.onclick = () => this.dropMessage(peer_id, index);
        buttonGroup.append(deliverButton, dropButton);
        messageDiv.append(messageText, buttonGroup);
        return messageDiv;
    }
    deliverMessage(peer_id, message_index) {
        const state = this.peers.get(peer_id);
        const els = this.peer_elements.get(peer_id);
        if (state.incoming_messages[message_index] instanceof Map) {
            mergeTree(state, state.incoming_messages[message_index]);
        }
        else {
            mergeEdits(state, state.incoming_messages[message_index]);
        }
        this.updateUI(state, els);
    }
    dropMessage(peer_id, message_index) {
        const state = this.peers.get(peer_id);
        state.incoming_messages = [
            ...state.incoming_messages.slice(0, message_index),
            ...state.incoming_messages.slice(message_index + 1)
        ];
        this.updateIncomingMessages(peer_id);
    }
    parseEdits(state, text_with_edits) {
        if (text_with_edits[0] !== '^') {
            return { type: 'Error', message: "Invalid edit: Document must start with '^'" };
        }
        const nodes = preorderTree(state.root_id, state.tree_by_id);
        let non_tombstone_node_ids = [nodes[0]]; // stack to delete
        let text_i = 1;
        let node_i = 1;
        let next_clock = state.next_clock;
        const edits = [];
        while (text_i < text_with_edits.length) {
            const result = this.parseEditToken(text_with_edits, text_i, node_i, state, nodes, non_tombstone_node_ids, next_clock);
            if (result.error) {
                return { type: 'Error', message: result.error };
            }
            if (result.edit)
                edits.push(result.edit);
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
    parseEditToken(text, text_i, node_i, state, nodes, non_tombstone_node_ids, next_clock) {
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
        const node = state.tree_by_id.get(nodes[node_i]);
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
    hasEdits(peer_id) {
        const state = this.peers.get(peer_id);
        const input = document.getElementById(`input${peer_id}`);
        const treeContent = treeToString(state.root_id, state.tree_by_id).slice(1); // slice(1) removes the '^'
        return input.value !== treeContent;
    }
    hasTreeChanges(state) {
        // Check if tree has more than just the root sentinel node
        return state.tree_by_id.size > 1;
    }
    updateButtonStates(peer_id) {
        const state = this.peers.get(peer_id);
        const sendTreeButton = document.getElementById(`send-tree${peer_id}`);
        // Disable send tree button if there are no changes or only root node
        sendTreeButton.disabled = !this.hasTreeChanges(state);
        // Update button tooltips for better UX
        sendTreeButton.title = sendTreeButton.disabled ? 'No tree changes to send' : 'Send tree state';
    }
}
// Initialize the application when the window loads
window.onload = () => {
    new CRDTEditor();
};
