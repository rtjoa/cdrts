"use strict";
function mk_id(peer_id, local_id) {
    return `${peer_id}/${local_id}`;
}
function init_state(peer_id) {
    let tree_by_id = new Map();
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
    };
}
;
window.onload = () => {
    var _a, _b;
    let peers = new Map();
    peers.set(1, init_state(1));
    peers.set(2, init_state(2));
    let peer_elements = new Map();
    peer_elements.set(1, {
        input: document.getElementById('input1'),
        tree: document.getElementById('tree1'),
        incoming: document.getElementById('incoming1'),
        error: document.getElementById('error1'),
    });
    peer_elements.set(2, {
        input: document.getElementById('input2'),
        tree: document.getElementById('tree2'),
        incoming: document.getElementById('incoming2'),
        error: document.getElementById('error2'),
    });
    function refresh_tree(peer_id) {
        let state = peers.get(peer_id);
        let els = peer_elements.get(peer_id);
        els.tree.textContent = repr_tree(state.root_id, state.tree_by_id, 0);
    }
    refresh_tree(1);
    refresh_tree(2);
    function commit(peer_id) {
        let state = peers.get(peer_id);
        let els = peer_elements.get(peer_id);
        let edits = parse_edits(state, "^" + els.input.value);
        if (edits.type === 'Error') {
            els.error.textContent = edits.message;
            return;
        }
        els.error.textContent = '';
        if (edits.edits.length === 0) {
            return;
        }
        merge(state, edits.edits);
        for (const other_peer_id of [1, 2]) {
            if (other_peer_id !== peer_id) {
                let other = peers.get(other_peer_id);
                other.incoming_messages.push(edits.edits);
                update_incoming_messages(other_peer_id);
            }
        }
        els.input.value = tree_to_string(state.root_id, state.tree_by_id).slice(1);
        els.tree.textContent = repr_tree(state.root_id, state.tree_by_id, 0);
    }
    function deliver_message(peer_id, message_index) {
        let state = peers.get(peer_id);
        let els = peer_elements.get(peer_id);
        let edits = state.incoming_messages[message_index];
        merge(state, edits);
        els.tree.textContent = repr_tree(state.root_id, state.tree_by_id, 0);
        els.input.value = tree_to_string(state.root_id, state.tree_by_id).slice(1);
        els.tree.textContent = repr_tree(state.root_id, state.tree_by_id, 0);
    }
    function drop_message(peer_id, message_index) {
        let state = peers.get(peer_id);
        state.incoming_messages = state.incoming_messages.slice(0, message_index).concat(state.incoming_messages.slice(message_index + 1));
        update_incoming_messages(peer_id);
    }
    function merge(state, edits) {
        for (const edit of edits) {
            if (edit.type === 'Insert') {
                // Do nothing if the node is already in the tree
                if (state.tree_by_id.has(edit.new_id)) {
                    continue;
                }
                // Update parent's children
                let parent = state.tree_by_id.get(edit.parent);
                let parent_updated = Object.assign({}, parent);
                parent_updated.children.push(edit.new_id);
                parent_updated.children.sort();
                state.tree_by_id.set(edit.parent, parent_updated);
                // Add the new node
                state.tree_by_id.set(edit.new_id, {
                    children: [],
                    value: edit.value,
                });
            }
            else {
                let to_delete = state.tree_by_id.get(edit.index);
                state.tree_by_id.set(edit.index, {
                    children: to_delete.children,
                    value: undefined,
                });
            }
        }
    }
    /* Human-readable string representation of a tree */
    function repr_tree(root_id, tree_by_id, indent) {
        var _a;
        let root = tree_by_id.get(root_id);
        let sHere = root_id + ' ' + ((_a = root.value) !== null && _a !== void 0 ? _a : '<Tombstone>');
        let result = '  '.repeat(indent) + sHere + '\n';
        for (const child of root.children) {
            result += repr_tree(child, tree_by_id, indent + 1);
        }
        return result;
    }
    // Concats tree contents in pre-order
    function tree_to_string(root_id, tree_by_id) {
        var _a;
        let root = tree_by_id.get(root_id);
        let result = (_a = root.value) !== null && _a !== void 0 ? _a : '';
        for (const child of root.children) {
            result += tree_to_string(child, tree_by_id);
        }
        return result;
    }
    function preorder_tree(root_id, tree_by_id) {
        let root = tree_by_id.get(root_id);
        let result = [];
        result.push(root_id);
        for (const child of root.children) {
            result = result.concat(preorder_tree(child, tree_by_id));
        }
        return result;
    }
    function repr_edit(edit) {
        if (edit.type === 'Insert') {
            return `after ${edit.parent} ins ${edit.new_id} ${edit.value}`;
        }
        else {
            return `del ${edit.index}`;
        }
    }
    function update_incoming_messages(peer_id) {
        let state = peers.get(peer_id);
        let els = peer_elements.get(peer_id);
        const incomingSection = document.getElementById(`incoming-section${peer_id}`);
        if (state.incoming_messages.length === 0) {
            incomingSection === null || incomingSection === void 0 ? void 0 : incomingSection.classList.remove('has-messages');
            return;
        }
        incomingSection === null || incomingSection === void 0 ? void 0 : incomingSection.classList.add('has-messages');
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
    function parse_edits(state, text_with_edits) {
        var _a, _b;
        let edits = [];
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
                });
                non_tombstone_node_ids.pop();
                text_i++;
            }
            else if (text_with_edits[text_i] == "+") {
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
            }
            else {
                while (node_i < nodes.length && ((_a = state.tree_by_id.get(nodes[node_i])) === null || _a === void 0 ? void 0 : _a.value) === undefined) {
                    node_i++;
                }
                if (node_i >= nodes.length) {
                    return { type: 'Error', message: "Error: text char but end of tree." };
                }
                let node = state.tree_by_id.get(nodes[node_i]);
                if (text_with_edits[text_i] !== node.value) {
                    return { type: 'Error', message: "Error: text char but tree char does not match." };
                }
                non_tombstone_node_ids.push(nodes[node_i]);
                text_i++;
                node_i++;
            }
        }
        while (node_i < nodes.length && ((_b = state.tree_by_id.get(nodes[node_i])) === null || _b === void 0 ? void 0 : _b.value) === undefined) {
            node_i++;
        }
        if (node_i < nodes.length) {
            return { type: 'Error', message: "Error: tree char but no text char." };
        }
        return { type: 'Ok', edits: edits, next_local_id: next_local_id };
    }
    (_a = document.getElementById('send1')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => commit(1));
    (_b = document.getElementById('send2')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => commit(2));
};
