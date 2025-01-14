# Design Evolution and Requirements

## Core Design Principles

### Browser-First Approach
- Let the browser handle visual updates whenever possible
- Don't simulate browser behavior unnecessarily
- Use native browser events and selection handling

### Text Input Philosophy
1. **Detect Changes, Not Actions**
   - Focus on what changed in the text, not how it changed
   - Compare old and new text states to determine edits
   - Avoid handling individual keystrokes when possible

2. **Natural Editing Experience**
   - Preserve standard text editor behaviors
   - Maintain cursor and selection state
   - Support all standard editing operations (copy/paste, selection, etc.)

## Key Design Changes

### Input Handling Evolution
1. **Initial Approach**
   - Manually handled each keystroke
   - Simulated browser behavior
   - Led to bugs and inconsistencies

2. **Current Approach**
   - Let browser handle input first
   - Compare text states to determine changes
   - Create CRDT operations based on differences

### Cursor/Selection Management
1. **Previous Implementation**
   - Tracked cursor position in CRDT state
   - Manually updated cursor after each operation
   - Complex coordinate system conversions

2. **Simplified Approach**
   - Removed cursor tracking from CRDT state
   - Let browser handle cursor movement
   - Save and restore selection during updates

### Newline Handling
1. **Initial Issues**
   - Inconsistent newline representation
   - Problems with HTML/text conversion
   - Multiple newlines causing tombstones

2. **Improved Solution**
   - Consistent HTML to text conversion
   - Proper handling of various newline formats
   - Preserved multiple consecutive newlines

## UI Improvements

### Visibility Controls
- Added toggle buttons for tree view
- Added toggle buttons for incoming messages
- Synchronized visibility state between peers

### Debug Information
- Tree visualization for CRDT structure
- Incoming message queue display
- Network simulation controls

## Known Limitations

### Current Constraints
- Limited to two peers
- Synchronous message processing
- No persistence between sessions

### Areas for Improvement
- Support for more peers
- Asynchronous message handling
- Persistent storage of document state

## Testing Focus Areas

### Critical Paths
- Text input and deletion
- Copy/paste operations
- Selection handling
- Newline behavior
- Concurrent edits

### Edge Cases
- Multiple consecutive newlines
- Complex paste content
- Selection-based operations
- Network delays and drops

## Future Considerations

### Potential Enhancements
- Support for rich text
- File attachments
- Multiple documents
- User presence indicators
- Offline mode

### Performance Optimizations
- Batch processing of edits
- Efficient tree traversal
- Message compression
- State reconciliation 