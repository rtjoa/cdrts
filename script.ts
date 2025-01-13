// Tree-based text CRDT
interface Tree { children: string[]; value?: string }
type Edit =
    | { type: 'Insert'; parent: string; new_id: string; value: string }
    | { type: 'Delete'; index: string }
type PeerState = {
    peer_id: number;
    next_local_id: number;
    tree_by_id: Map<string, Tree>;
    root_id: string;
    incoming_messages: Edit[][];
}

function mk_id(peer_id: number, local_id: number): string {
    return `${peer_id}/${local_id}`;
}

function init_state(peer_id: number): PeerState {
    let tree_by_id = new Map<string, Tree>();
    let root_id = mk_id(0, 0);
    tree_by_id.set(root_id, {
        children: [],
        value: '^'
    });
    return {
        peer_id: peer_id,
        root_id: root_id,
        tree_by_id: tree_by_id,
        next_local_id: 1,
        incoming_messages: [],
    }
};

// Interface
interface PeerElements {
    input: HTMLTextAreaElement;
    tree: HTMLDivElement;
    incoming: HTMLDivElement;
    error: HTMLDivElement;
}


window.onload = () => {

    let peers = new Map<number, PeerState>();
    peers.set(1, init_state(1));
    peers.set(2, init_state(2));
    let peer_elements = new Map<number, PeerElements>();
    peer_elements.set(1, {
        input: document.getElementById('input1') as HTMLTextAreaElement,
        tree: document.getElementById('tree1') as HTMLDivElement,
        incoming: document.getElementById('incoming1') as HTMLDivElement,
        error: document.getElementById('error1') as HTMLDivElement,
    });
    peer_elements.set(2, {
        input: document.getElementById('input2') as HTMLTextAreaElement,
        tree: document.getElementById('tree2') as HTMLDivElement,
        incoming: document.getElementById('incoming2') as HTMLDivElement,
        error: document.getElementById('error2') as HTMLDivElement,
    });

    function refresh_tree(peer_id: number) {
        let state = peers.get(peer_id) as PeerState;
        let els = peer_elements.get(peer_id) as PeerElements;
        els.tree.textContent = repr_tree(state.root_id, state.tree_by_id, 0);
    }
    refresh_tree(1);
    refresh_tree(2);


    function commit(peer_id: number) {
        let state = peers.get(peer_id) as PeerState;
        let els = peer_elements.get(peer_id) as PeerElements;

        let edits = parse_edits(state, "^" + els.input.value);
        if (edits.type === 'Error') {
            els.error.textContent = edits.message;
            return;
        }

        state.next_local_id = edits.next_local_id;
        els.error.textContent = '';
        if (edits.edits.length === 0) {
            return;
        }

        merge(state, edits.edits);
        for (const other_peer_id of [1, 2]) {
            if (other_peer_id !== peer_id) {
                let other = peers.get(other_peer_id) as PeerState;
                other.incoming_messages.push(edits.edits);
                update_incoming_messages(other_peer_id);
            }
        }
        els.input.value = tree_to_string(state.root_id, state.tree_by_id).slice(1);
        els.tree.textContent = repr_tree(state.root_id, state.tree_by_id, 0);
    }

    function deliver_message(peer_id: number, message_index: number) {
        let state = peers.get(peer_id) as PeerState;
        let els = peer_elements.get(peer_id) as PeerElements;
        let edits = state.incoming_messages[message_index];
        merge(state, edits);
        els.tree.textContent = repr_tree(state.root_id, state.tree_by_id, 0);

        els.input.value = tree_to_string(state.root_id, state.tree_by_id).slice(1);
        els.tree.textContent = repr_tree(state.root_id, state.tree_by_id, 0);
    }

    function drop_message(peer_id: number, message_index: number) {
        let state = peers.get(peer_id) as PeerState;
        state.incoming_messages = state.incoming_messages.slice(0, message_index).concat(state.incoming_messages.slice(message_index + 1));
        update_incoming_messages(peer_id);
    }

    function merge(state: PeerState, edits: Edit[]) {
        for (const edit of edits) {
            if (edit.type === 'Insert') {
                // Do nothing if the node is already in the tree
                if (state.tree_by_id.has(edit.new_id)) {
                    continue;
                }

                // Update parent's children
                let parent = state.tree_by_id.get(edit.parent) as Tree;
                let parent_updated = { ...parent };
                parent_updated.children.push(edit.new_id);
                parent_updated.children.sort();
                state.tree_by_id.set(edit.parent, parent_updated);

                // Add the new node
                state.tree_by_id.set(edit.new_id, {
                    children: [],
                    value: edit.value,
                });
            } else {
                let to_delete = state.tree_by_id.get(edit.index) as Tree;
                state.tree_by_id.set(edit.index, {
                    children: to_delete.children,
                    value: undefined,
                });
            }
        }
    }

    /* Human-readable string representation of a tree */
    function repr_tree(root_id: string, tree_by_id: Map<string, Tree>, indent: number): string {
        let root = tree_by_id.get(root_id) as Tree;
        let sHere = root_id + ' ' + (root.value ?? '<Tombstone>');
        let result = '  '.repeat(indent) + sHere + '\n';
        for (const child of root.children) {
            result += repr_tree(child, tree_by_id, indent + 1);
        }
        return result;
    }

    // Concats tree contents in pre-order
    function tree_to_string(root_id: string, tree_by_id: Map<string, Tree>): string {
        let root = tree_by_id.get(root_id) as Tree;
        let result = root.value ?? '';
        for (const child of root.children) {
            result += tree_to_string(child, tree_by_id);
        }
        return result;
    }

    function preorder_tree(root_id: string, tree_by_id: Map<string, Tree>): string[] {
        let root = tree_by_id.get(root_id) as Tree;
        let result: string[] = [];
        result.push(root_id);
        for (const child of root.children) {
            result = result.concat(preorder_tree(child, tree_by_id));
        }
        return result;
    }

    function repr_edit(edit: Edit): string {
        if (edit.type === 'Insert') {
            return `after ${edit.parent} ins ${edit.new_id} ${edit.value}`;
        } else {
            return `del ${edit.index}`;
        }
    }

    function update_incoming_messages(peer_id: number) {
        let state = peers.get(peer_id) as PeerState;
        let els = peer_elements.get(peer_id) as PeerElements;

        const incomingSection = document.getElementById(`incoming-section${peer_id}`);
        if (state.incoming_messages.length === 0) {
            incomingSection?.classList.remove('has-messages');
            return;
        }
        incomingSection?.classList.add('has-messages');

        els.incoming.innerHTML = '';
        state.incoming_messages.forEach((message, index) => {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message-container';

            const messageText = document.createElement('pre');
            messageText.className = 'message-text';
            messageText.textContent = message.map(edit => repr_edit(edit)).join('\n');

            const buttonGroup = document.createElement('div');
            buttonGroup.className = 'button-group';

            const deliverButton = document.createElement('button');
            deliverButton.textContent = 'Deliver';
            deliverButton.onclick = () => deliver_message(peer_id, index);

            const dropButton = document.createElement('button');
            dropButton.textContent = 'Drop';
            dropButton.onclick = () => drop_message(peer_id, index);

            buttonGroup.appendChild(deliverButton);
            buttonGroup.appendChild(dropButton);
            messageDiv.appendChild(messageText);
            messageDiv.appendChild(buttonGroup);
            els.incoming.appendChild(messageDiv);
        });
    }

    /*
    Edit syntax is as follows:
     
    If the current text is "hello world"
     
    The following is an insertion of "ab" at index 6:
    hello +a+bworld
     
    The following is a deletion of "world":
    hello -w-o-r-l-d
     
    The new text without the edits must match the old tree as a string.
    If not, it gives an error.
     */

    type ParsedEdits =
        | { type: 'Ok'; edits: Edit[]; next_local_id: number }
        | { type: 'Error'; message: string }

    function parse_edits(state: PeerState, text_with_edits: string): ParsedEdits {
        let edits: Edit[] = [];

        let nodes = preorder_tree(state.root_id, state.tree_by_id);
        if (text_with_edits[0] !== '^') {
            return { type: 'Error', message: "Error: need doc start." };
        }
        let non_tombstone_node_ids = [nodes[0]];
        let text_i = 1;
        let node_i = 1;
        let next_local_id = state.next_local_id;
        while (text_i < text_with_edits.length) {
            if (text_with_edits[text_i] === '-') {
                edits.push({
                    type: 'Delete',
                    index: non_tombstone_node_ids[non_tombstone_node_ids.length - 1],
                })
                non_tombstone_node_ids.pop();
                text_i++;
            } else if (text_with_edits[text_i] == "+") {
                if (text_i + 1 >= text_with_edits.length) {
                    return { type: 'Error', message: "Error: Unmatched add marker found at the end of the text." };
                }
                let new_id = mk_id(state.peer_id, next_local_id);
                edits.push({
                    type: "Insert",
                    parent: non_tombstone_node_ids[non_tombstone_node_ids.length - 1],
                    new_id: mk_id(state.peer_id, next_local_id),
                    value: text_with_edits[text_i + 1]
                });
                non_tombstone_node_ids.push(new_id);
                next_local_id++;
                text_i += 2;
            } else {
                while (node_i < nodes.length && state.tree_by_id.get(nodes[node_i])?.value === undefined) {
                    node_i++;
                }
                if (node_i >= nodes.length) {
                    return { type: 'Error', message: "Error: text char but end of tree." };
                }
                let node = state.tree_by_id.get(nodes[node_i]) as Tree;
                if (text_with_edits[text_i] !== node.value) {
                    return { type: 'Error', message: "Error: text char but tree char does not match." };
                }
                non_tombstone_node_ids.push(nodes[node_i]);
                text_i++;
                node_i++;
            }
        }
        while (node_i < nodes.length && state.tree_by_id.get(nodes[node_i])?.value === undefined) {
            node_i++;
        }
        if (node_i < nodes.length) {
            return { type: 'Error', message: "Error: tree char but no text char." };
        }

        return { type: 'Ok', edits: edits, next_local_id: next_local_id };
    }

    document.getElementById('send1')?.addEventListener('click', () => commit(1));
    document.getElementById('send2')?.addEventListener('click', () => commit(2));

};