# CRDT Text Editor Implementation Notes

## Core Architecture

### CRDT Structure
- Tree-based CRDT where each character is a node
- Root node is a sentinel ('^') that's never displayed
- Nodes are uniquely identified by `peer_id/clock` format
- Tree is traversed in preorder for display and operations

### State Management
- Each peer maintains:
  - `peer_id`: Unique identifier (1 or 2)
  - `next_clock`: Monotonically increasing counter
  - `tree_by_id`: Map of node IDs to tree nodes
  - `root_id`: ID of sentinel node (always "0/0")
  - `incoming_messages`: Queue of pending messages

## Important Implementation Details

### Coordinate Systems
There are three different coordinate systems to be aware of:
1. **Browser Text Coordinates**
   - 0-based
   - No sentinel node
   - What the user sees/interacts with
   
2. **Visible Node Array**
   - 0-based after removing sentinel
   - Used for mapping text positions to nodes
   - Created by filtering tombstones from preorder traversal
   
3. **Tree Coordinates**
   - Includes sentinel node
   - Used for tree operations
   - What's shown in the tree view

### Text Input Handling
1. **Regular Input**
   - Uses `handleInput` method
   - Compares old and new text using `findTextDiff`
   - Creates appropriate Insert/Delete edits
   
2. **Paste Events**
   - Uses setTimeout to let browser handle paste first
   - Converts HTML to text properly handling newlines
   - Special handling in `convertHTMLToText`:
     - `<div><br></div>` → single newline
     - `<div>text</div>` → `\ntext`
     - `<br>` → newline

3. **Special Keys**
   - Tab: Prevented and handled manually
   - Enter: Handled through input event as 'insertParagraph'
   - Arrow keys: Let browser handle movement

### Selection Handling
- Selection state is preserved during updates using:
  - `saveSelection`: Captures current selection state
  - `transformPosition`: Adjusts positions based on text changes
  - `restoreSelection`: Reapplies transformed selection

### Common Pitfalls

1. **Sentinel Node**
   - Must be excluded when displaying text
   - Must be included when finding parent nodes
   - Critical for handling insertions at start of text

2. **HTML/Text Conversion**
   - Newlines require special handling due to contenteditable div
   - Must handle various HTML representations consistently
   - Paste events can introduce unexpected HTML

3. **Cursor Position**
   - Browser positions don't include sentinel
   - Must adjust when mapping between coordinate systems
   - Selection can be lost if not properly preserved

4. **Edit Application**
   - Deletions must preserve node's children
   - Insertions must maintain correct order (sort by ID)
   - Must handle concurrent edits correctly

## Network Simulation

### Message Processing
- Configurable delay (in seconds)
- Auto-process option
- Manual process/drop controls
- Visual countdown for pending messages

### Message Types
1. **Edit Messages**
   - Series of Insert/Delete operations
   - Applied in order received
   
2. **Tree Messages**
   - Complete tree state
   - Used for full sync

## UI Components

### Editor Elements
Each peer has:
- Contenteditable div (main editor)
- Hidden textarea (for debugging)
- Tree view (shows CRDT structure)
- Incoming messages section
- Toggle controls

### Visibility Controls
- Tree view can be toggled
- Incoming messages can be toggled
- State is synced between peers

## Testing Considerations

### Edge Cases to Test
1. **Input Sequences**
   - Multiple consecutive newlines
   - Paste with mixed content
   - Selection spanning multiple lines
   
2. **Concurrent Edits**
   - Simultaneous edits at same position
   - Overlapping deletions
   - Insert/delete conflicts

3. **Network Conditions**
   - Out of order message delivery
   - Message drops
   - Various processing delays

## Debugging Tips

### Common Issues
1. **Text Mismatches**
   - Check coordinate system mappings
   - Verify HTML to text conversion
   - Inspect tree structure vs visible text

2. **Selection Problems**
   - Verify selection preservation
   - Check position transformations
   - Inspect HTML structure

3. **Sync Issues**
   - Compare tree structures between peers
   - Check message processing order
   - Verify edit application logic

### Useful Debug Information
- Tree structure visualization
- Edit operation logs
- Text content at various stages
- Selection state tracking 