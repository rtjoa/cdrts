// Types and interfaces
interface Tree {
    children: string[];
    value?: string
}

type Edit =
    | { type: 'Insert'; parent: string; new_id: string; value: string }
    | { type: 'Delete'; index: string }

type ParsedEdits =
    | { type: 'Ok'; edits: Edit[]; next_local_id: number }
    | { type: 'Error'; message: string }

interface PeerState {
    peer_id: number;
    next_local_id: number;
    tree_by_id: Map<string, Tree>;
    root_id: string;
    incoming_messages: Edit[][];
}

interface PeerElements {
    input: HTMLTextAreaElement;
    tree: HTMLDivElement;
    incoming: HTMLDivElement;
    error: HTMLDivElement;
}

// Helper functions
const mk_id = (peer_id: number, local_id: number): string =>
    `${peer_id}/${local_id}`;

const init_state = (peer_id: number): PeerState => ({
    peer_id,
    root_id: mk_id(0, 0),
    tree_by_id: new Map([
        [mk_id(0, 0), { children: [], value: '^' }]
    ]),
    next_local_id: 1,
    incoming_messages: [],
});

const reprTree = (root_id: string, tree_by_id: Map<string, Tree>, indent: number): string => {
    const root = tree_by_id.get(root_id) as Tree;
    const indentation = '  '.repeat(indent);
    const nodeValue = root.value ?? '<Tombstone>';
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
        ? `after ${edit.parent} ins ${edit.new_id} ${edit.value}`
        : `del ${edit.index}`;
};

const isNodeTombstone = (node_id: string, tree_by_id: Map<string, Tree>): boolean => {
    return tree_by_id.get(node_id)?.value === undefined;
};

const merge = (state: PeerState, edits: Edit[]): void => {
    edits.forEach(edit => {
        if (edit.type === 'Insert') {
            if (state.tree_by_id.has(edit.new_id)) return;

            const parent = state.tree_by_id.get(edit.parent) as Tree;
            const parent_updated = {
                ...parent,
                children: [...parent.children, edit.new_id].sort((id1, id2) => {
                    // Sort by increasing peer id, then decreasing local id
                    let [peer_id1, local_id1] = id1.split('/');
                    let [peer_id2, local_id2] = id2.split('/');
                    let peer_id1_num = parseInt(peer_id1);
                    let peer_id2_num = parseInt(peer_id2);
                    let local_id1_num = parseInt(local_id1);
                    let local_id2_num = parseInt(local_id2);
                    if (peer_id1_num !== peer_id2_num) {
                        return peer_id1_num - peer_id2_num;
                    }
                    return local_id2_num - local_id1_num;
                })
            };

            state.tree_by_id.set(edit.parent, parent_updated);
            state.tree_by_id.set(edit.new_id, {
                children: [],
                value: edit.value,
            });
        } else {
            const to_delete = state.tree_by_id.get(edit.index) as Tree;
            state.tree_by_id.set(edit.index, {
                children: to_delete.children,
                value: undefined,
            });
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
        document.getElementById('send1')?.addEventListener('click', () => this.commit(1));
        document.getElementById('send2')?.addEventListener('click', () => this.commit(2));
        this.refreshTree(1);
        this.refreshTree(2);
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

        state.next_local_id = edits.next_local_id;
        els.error.textContent = '';
        if (edits.edits.length === 0) return;

        merge(state, edits.edits);
        this.broadcastEdits(peer_id, edits.edits);
        this.updateUI(state, els);
    }

    private broadcastEdits(sender_id: number, edits: Edit[]): void {
        [1, 2].forEach(peer_id => {
            if (peer_id !== sender_id) {
                const peer = this.peers.get(peer_id) as PeerState;
                peer.incoming_messages.push(edits);
                this.updateIncomingMessages(peer_id);
            }
        });
    }

    private updateUI(state: PeerState, els: PeerElements): void {
        els.input.value = treeToString(state.root_id, state.tree_by_id).slice(1);
        els.tree.textContent = reprTree(state.root_id, state.tree_by_id, 0);
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

    private createMessageElement(message: Edit[], peer_id: number, index: number): HTMLDivElement {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-container';

        const messageText = document.createElement('pre');
        messageText.className = 'message-text';
        messageText.textContent = message.map(edit => reprEdit(edit)).join('\n');

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'button-group';

        const deliverButton = document.createElement('button');
        deliverButton.textContent = 'Deliver';
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

        merge(state, state.incoming_messages[message_index]);
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
            return { type: 'Error', message: "Error: need doc start." };
        }

        const nodes = preorderTree(state.root_id, state.tree_by_id);
        let non_tombstone_node_ids = [nodes[0]];
        let text_i = 1;
        let node_i = 1;

        let num_additions = text_with_edits.split('+').length - 1;
        let next_next_local_id = state.next_local_id + num_additions;
        let next_local_id = next_next_local_id - 1;
        const edits: Edit[] = [];

        while (text_i < text_with_edits.length) {
            const result = this.parseEditToken(
                text_with_edits, text_i, node_i,
                state, nodes, non_tombstone_node_ids, next_local_id
            );

            if (result.error) {
                return { type: 'Error', message: result.error };
            }

            if (result.edit) edits.push(result.edit);
            text_i = result.text_i;
            node_i = result.node_i;
            next_local_id = result.next_local_id;
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

        return { type: 'Ok', edits, next_local_id: next_next_local_id };
    }

    private parseEditToken(
        text: string,
        text_i: number,
        node_i: number,
        state: PeerState,
        nodes: string[],
        non_tombstone_node_ids: string[],
        next_local_id: number
    ): {
        text_i: number;
        node_i: number;
        next_local_id: number;
        non_tombstone_node_ids: string[];
        edit?: Edit;
        error?: string;
    } {
        const char = text[text_i];

        if (char === '-') {
            return {
                text_i: text_i + 1,
                node_i,
                next_local_id,
                non_tombstone_node_ids: non_tombstone_node_ids.slice(0, -1),
                edit: {
                    type: 'Delete',
                    index: non_tombstone_node_ids[non_tombstone_node_ids.length - 1]
                }
            };
        }

        if (char === '+') {
            if (text_i + 1 >= text.length) {
                return {
                    error: "Error: Unmatched add marker found at the end of the text.",
                    text_i, node_i, next_local_id, non_tombstone_node_ids
                };
            }

            const new_id = mk_id(state.peer_id, next_local_id);
            return {
                text_i: text_i + 2,
                node_i,
                next_local_id: next_local_id - 1,
                non_tombstone_node_ids: [...non_tombstone_node_ids, new_id],
                edit: {
                    type: 'Insert',
                    parent: non_tombstone_node_ids[non_tombstone_node_ids.length - 1],
                    new_id,
                    value: text[text_i + 1]
                }
            };
        }

        while (node_i < nodes.length && isNodeTombstone(nodes[node_i], state.tree_by_id)) {
            node_i++;
        }

        if (node_i >= nodes.length) {
            return {
                error: "Error: text char but end of tree.",
                text_i, node_i, next_local_id, non_tombstone_node_ids
            };
        }

        const node = state.tree_by_id.get(nodes[node_i]) as Tree;
        if (text[text_i] !== node.value) {
            return {
                error: "Error: text char but tree char does not match.",
                text_i, node_i, next_local_id, non_tombstone_node_ids
            };
        }

        return {
            text_i: text_i + 1,
            node_i: node_i + 1,
            next_local_id,
            non_tombstone_node_ids: [...non_tombstone_node_ids, nodes[node_i]]
        };
    }
}

// Initialize the application when the window loads
window.onload = () => {
    new CRDTEditor();
};