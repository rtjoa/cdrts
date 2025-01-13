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

interface PeerState {
    peer_id: number;
    next_clock: number;
    tree_by_id: Map<string, Tree>;
    root_id: string;
    incoming_messages: (Edit[] | Map<string, Tree>)[];
}

interface PeerElements {
    input: HTMLTextAreaElement;
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
    const root = tree_by_id.get(root_id) as Tree;
    const indentation = '  '.repeat(indent);
    const nodeValue = root.value !== undefined ? escapeSpecialChars(root.value) : '<Tombstone>';
    const result = `${indentation}${root_id} ${nodeValue}\n`;

    return root.children.reduce(
        (acc, child) => acc + reprTree(child, tree_by_id, indent + 1),
        result
    );
};

const treeToString = (root_id: string, tree_by_id: Map<string, Tree>): string => {
    const root = tree_by_id.get(root_id) as Tree;
    const value = root.value ?? '';

    return root.children.reduce(
        (acc, child) => acc + treeToString(child, tree_by_id),
        value
    );
};

const preorderTree = (root_id: string, tree_by_id: Map<string, Tree>): string[] => {
    const root = tree_by_id.get(root_id) as Tree;
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

            const parent = state.tree_by_id.get(edit.parent) as Tree;
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
            const to_delete = state.tree_by_id.get(edit.index) as Tree;
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

    constructor() {
        this.peers = new Map([
            [1, init_state(1)],
            [2, init_state(2)]
        ]);

        this.peer_elements = new Map([
            [1, this.initPeerElements(1)],
            [2, this.initPeerElements(2)]
        ]);

        this.initializeUI();
    }

    private initPeerElements(peer_id: number): PeerElements {
        return {
            input: document.getElementById(`input${peer_id}`) as HTMLTextAreaElement,
            tree: document.getElementById(`tree${peer_id}`) as HTMLDivElement,
            incoming: document.getElementById(`incoming${peer_id}`) as HTMLDivElement,
            error: document.getElementById(`error${peer_id}`) as HTMLDivElement,
        };
    }

    private initializeUI(): void {
        // Set initial text for Peer 1 before adding event listeners
        const peer1Input = document.getElementById('input1') as HTMLTextAreaElement;
        peer1Input.value = '+h+e+l+l+o';

        // Set initial button states before adding event listeners
        this.refreshTree(1);
        this.refreshTree(2);
        this.updateButtonStates(1);
        this.updateButtonStates(2);

        // Add event listeners after initial states are set
        document.getElementById('send1')?.addEventListener('click', () => this.commit(1));
        document.getElementById('send-tree1')?.addEventListener('click', () => this.sendTree(1));
        document.getElementById('send2')?.addEventListener('click', () => this.commit(2));
        document.getElementById('send-tree2')?.addEventListener('click', () => this.sendTree(2));

        // Add input event listeners
        document.getElementById('input1')?.addEventListener('input', () => this.updateButtonStates(1));
        document.getElementById('input2')?.addEventListener('input', () => this.updateButtonStates(2));
    }

    private refreshTree(peer_id: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;
        els.tree.textContent = reprTree(state.root_id, state.tree_by_id, 0);
    }

    private commit(peer_id: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;

        const edits = this.parseEdits(state, "^" + els.input.value);
        if (edits.type === 'Error') {
            els.error.textContent = edits.message;
            return;
        }

        state.next_clock = edits.next_clock;
        els.error.textContent = '';
        if (edits.edits.length === 0) return;

        mergeEdits(state, edits.edits);
        this.broadcastEdits(peer_id, edits.edits);
        this.updateUI(state, els);
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
                peer.incoming_messages.push(message);
                this.updateIncomingMessages(peer_id);
            }
        });
    }

    private updateUI(state: PeerState, els: PeerElements): void {
        els.input.value = treeToString(state.root_id, state.tree_by_id).slice(1);
        els.tree.textContent = reprTree(state.root_id, state.tree_by_id, 0);
        this.updateButtonStates(state.peer_id);
    }

    private updateIncomingMessages(peer_id: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;
        const incomingSection = document.getElementById(`incoming-section${peer_id}`);

        if (state.incoming_messages.length === 0) {
            incomingSection?.classList.remove('has-messages');
            return;
        }

        incomingSection?.classList.add('has-messages');
        els.incoming.innerHTML = '';

        state.incoming_messages.forEach((message, index) => {
            const messageEl = this.createMessageElement(message, peer_id, index);
            els.incoming.appendChild(messageEl);
        });
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

    private deliverMessage(peer_id: number, message_index: number): void {
        const state = this.peers.get(peer_id) as PeerState;
        const els = this.peer_elements.get(peer_id) as PeerElements;

        if (state.incoming_messages[message_index] instanceof Map) {
            mergeTree(state, state.incoming_messages[message_index]);
        } else {
            mergeEdits(state, state.incoming_messages[message_index]);
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
        const commitButton = document.getElementById(`send${peer_id}`) as HTMLButtonElement;
        const sendTreeButton = document.getElementById(`send-tree${peer_id}`) as HTMLButtonElement;

        // Disable commit button if there are no edits
        commitButton.disabled = !this.hasEdits(peer_id);

        // Disable send tree button if there are no changes or only root node
        sendTreeButton.disabled = !this.hasTreeChanges(state);

        // Update button tooltips for better UX
        commitButton.title = commitButton.disabled ? 'No changes to commit' : 'Commit changes';
        sendTreeButton.title = sendTreeButton.disabled ? 'No tree changes to send' : 'Send tree state';
    }
}

// Initialize the application when the window loads
window.onload = () => {
    new CRDTEditor();
};