# React Error #185 Investigation Steps

## Build Information
- **Frontend rebuilt with comprehensive console logging**
- **TypeScript compilation: PASS**
- **Ready to deploy to EC2**

## Console Logging Added

### LetterTemplatesViewer.tsx
- 🟠 Parent render counter (logs render #N)
- 🟠 onChange callback execution with content length and render count

### PaginatedTemplateEditor.tsx
- 🔵 useEffect([value, onChange]) - logs every execution
- 🟡 useLayoutEffect([blocks]) - logs every execution with pages info
- 🟢 useLayoutEffect([pages]) - logs caret positioning
- 🔴 applyBlocks() - logs block counts and changes
- 🟣 handleInsertTable() - logs table insertion sequence

## Reproduction Steps

1. **Deploy to EC2** (build is ready)
2. **Open browser DevTools Console** (Ctrl+Shift+I)
3. **Navigate to Letter Templates** page
4. **Click "Create New Template"** or **"Edit"** an existing template
5. **Click "Insert Table"** button in the toolbar
6. **Select rows/columns** in the table picker dialog
7. **Click "Insert"** button

## Expected Log Output

Watch for the sequence of:
1. 🟣 handleInsertTable START/END
2. 🔴 applyBlocks START/END
3. 🔵 useEffect([value, onChange]) fires
4. 🟡 useLayoutEffect([blocks]) fires
5. 🟢 useLayoutEffect([pages]) fires

## Key Things to Monitor

1. **Does the value change on every iteration?**
   - Compare normalizedValue.length vs value.length in logs

2. **Does onChange get called multiple times?**
   - 🔴 applyBlocks should call onChange once per table insertion
   - If it's called repeatedly, the parent is re-rendering

3. **Does parent keep re-rendering?**
   - 🟠 render counter increases
   - 🟠 onChange callback fires after each re-render

4. **Does setBlocks keep changing?**
   - 🔵 Check "are blocks same?" - should be true on repeated calls

5. **Do effects fire repeatedly?**
   - Count how many times each effect fires before the error

## Critical Question to Answer

**Which of these is repeatedly changing?**
- A) Parent's editing.content prop → value prop
- B) Parent's onChange function reference  
- C) Child's blocks state
- D) normalizedValue calculation (different each time)
- E) Something else?

Once we identify which value keeps changing, we can trace why it's causing the loop.

## Next Steps After Investigation

1. Screenshot/copy the console output showing the loop
2. Identify the exact sequence (e.g., A → B → C → A)
3. Identify which value is changing on each iteration
4. Propose minimal fix based on root cause
