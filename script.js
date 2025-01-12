"use strict";
;
let el_input1;
let el_input2;
let el_tree1;
let el_tree2;
let el_lastEdits1;
let el_lastEdits2;
let el_output;
let el_updateButton;
window.onload = () => {
    el_input1 = document.getElementById('input1');
    el_input2 = document.getElementById('input2');
    el_tree1 = document.getElementById('tree1');
    el_tree2 = document.getElementById('tree2');
    el_lastEdits1 = document.getElementById('last-edits-1');
    el_lastEdits2 = document.getElementById('last-edits-2');
    el_output = document.getElementById('output');
    el_updateButton = document.getElementById('updateButton');
    el_updateButton.addEventListener('click', update);
    el_input1.value = "";
    el_input2.value = "";
    update();
};
function init_state(peer_id) {
    return {
        peer_id: peer_id,
        tree: {
            id: { peer_id: 0, local_id: 0 },
            node: { type: 'Data', value: '^' },
            children: []
        },
        next_id: 1,
    };
}
;
let state1 = init_state(1);
let state2 = init_state(2);
function update() {
    el_tree1.textContent = repr_tree(state1.tree, 0);
    el_tree2.textContent = repr_tree(state2.tree, 0);
    let edits1 = parse_edits(state1, "^" + el_input1.value, state1.tree);
    let edits2 = parse_edits(state2, "^" + el_input2.value, state2.tree);
    el_lastEdits1.textContent = edits1 instanceof Array ? edits1.map(repr_edit).join('\n') : edits1;
    el_lastEdits2.textContent = edits2 instanceof Array ? edits2.map(repr_edit).join('\n') : edits2;
    if (edits1 instanceof Array && edits2 instanceof Array) {
        state1.tree = merge(state1.tree, edits2);
        state2.tree = merge(state2.tree, edits1);
    }
    let content1 = tree_to_string(state1.tree);
    let content2 = tree_to_string(state2.tree);
    if (content1 !== content2) {
        el_output.textContent = "Conflict!\n" + content1 + "\n\n" + content2;
    }
    else {
        el_output.textContent = content1;
    }
}
function createIdMap(tree) {
    const map = new Map();
    function addToMap(node) {
        const idKey = `${node.id.peer_id}/${node.id.local_id}`;
        map.set(idKey, node);
        for (const child of node.children) {
            addToMap(child);
        }
    }
    addToMap(tree);
    return map;
}
function merge(tree, edits) {
    let id_map = createIdMap(tree);
    return tree;
}
// Root is always a tombstone with id 0
/* Human-readable string representation of a tree */
function repr_tree(tree, indent) {
    let sHere = tree.id.peer_id + '/' + tree.id.local_id + ' ' + (tree.node.type === 'Data' ? tree.node.value : '<Tombstone>');
    let result = '  '.repeat(indent) + sHere + '\n';
    for (const child of tree.children) {
        result += repr_tree(child, indent + 1);
    }
    return result;
}
/* Concats tree contents in pre-order */
function tree_to_string(tree) {
    let result = tree.node.type === 'Data' ? tree.node.value : '';
    for (const child of tree.children) {
        result += tree_to_string(child);
    }
    return result;
}
function preorder_tree(tree) {
    let result = [];
    result.push(tree);
    for (const child of tree.children) {
        result = result.concat(preorder_tree(child));
    }
    return result;
}
function repr_edit(edit) {
    if (edit.type === 'Insert') {
        let new_node = edit.node.node;
        return "after " + edit.parent.peer_id + '/' + edit.parent.local_id + ' ' + new_node.value;
    }
    else {
        return "del " + edit.index.peer_id + '/' + edit.index.local_id;
    }
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
function parse_edits(state, text_with_edits, tree) {
    let edits = [];
    let nodes = preorder_tree(tree);
    if (text_with_edits[0] !== '^') {
        return "Error: need doc start.";
    }
    let non_tombstone_node_ids = [nodes[0].id];
    let text_i = 1;
    let node_i = 1;
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
                return "Error: Unmatched add marker found at the end of the text.";
            }
            let new_node = {
                id: { peer_id: state.peer_id, local_id: state.next_id },
                node: {
                    type: 'Data',
                    value: text_with_edits[text_i + 1]
                },
                children: [],
            };
            state.next_id++;
            edits.push({
                type: "Insert",
                parent: non_tombstone_node_ids[non_tombstone_node_ids.length - 1],
                node: new_node,
            });
            non_tombstone_node_ids.push(new_node.id);
            text_i += 2;
        }
        else {
            while (node_i + 1 < nodes.length && nodes[node_i + 1].node.type === 'Tombstone') {
                node_i++;
            }
            if (node_i >= nodes.length) {
                return "Error: text char but end of tree.";
            }
            let node = nodes[node_i].node;
            if (text_with_edits[text_i] !== node.value) {
                return "Error: text char but tree char does not match.";
            }
            text_i++;
            node_i++;
        }
    }
    while (node_i < nodes.length && nodes[node_i].node.type === 'Tombstone') {
        node_i++;
    }
    if (node_i < nodes.length) {
        return "Error: tree char but no text char.";
    }
    return edits;
}
