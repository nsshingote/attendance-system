# Console Logging Summary - React Error #185 Investigation

## Files Modified with Logging

### 1. LetterTemplatesViewer.tsx (Parent Component)

```typescript
// Line 15-17: Added render counter
const renderCount = useRef(0);
renderCount.current++;
console.log(`🟠 [LetterTemplatesViewer] RENDER #${renderCount.current}`);

// Line 34-37: Added onChange logging
onChange={content => {
  console.log('🟠 [onChange callback] FIRED - content length:', content.length, 'renderCount:', renderCount.current);
  setEditing({ ...editing, content });
}}
```

**What it tracks:**
- How many times parent re-renders
- Every time onChange callback is executed (with content length and current render #)
- Will reveal if onChange is called repeatedly per render

---

### 2. PaginatedTemplateEditor.tsx (Child Component)

#### Effect 1: useEffect([value, onChange])
```typescript
console.log('🔵 [useEffect value,onChange] FIRE - value.length:', value.length);
const next = normalizeBlocks(splitDynamicTemplateBlocks(value));
console.log('🔵 normalizeBlocks returned', next.length, 'blocks');
setBlocks(current => {
  const isSame = JSON.stringify(current) === JSON.stringify(next);
  console.log('🔵 setBlocks - are blocks same?', isSame);
  return isSame ? current : next;
});
const normalizedValue = joinDynamicTemplateBlocks(next);
console.log('🔵 normalizedValue.length:', normalizedValue.length, 'value.length:', value.length, 'equal?', normalizedValue === value);
if (normalizedValue !== value) {
  console.log('🔵 ⚠️ CALLING onChange - normalized !== original');
  onChange(normalizedValue);
} else {
  console.log('🔵 ✓ NOT calling onChange - values are equal');
}
```

**What it tracks:**
- Every time effect fires (logs value.length)
- Block normalization results
- Whether setBlocks actually changes state (are blocks same?)
- normalizedValue vs value comparison
- Whether onChange is called and why

#### Effect 2: useLayoutEffect([blocks])
```typescript
console.log('🟡 [useLayoutEffect blocks] FIRE - blocks.length:', blocks.length);
if (typeof document !== "undefined") {
  setPages(paginateDynamicTemplateBlocks(blocks));
  console.log('🟡 setPages called');
}
```

**What it tracks:**
- Every time blocks change
- When setPages is called

#### Effect 3: useLayoutEffect([pages])
```typescript
console.log('🟢 [useLayoutEffect pages] FIRE - pages:', pages?.length, 'pendingCaret:', pendingCaret.current);
// ... rest of caret positioning logic ...
if (!fragment) {
  console.log('🟢 no fragment found for caret');
  return;
}
// ...
console.log('🟢 caret positioned and cleared');
```

**What it tracks:**
- Every time pages change
- Whether pendingCaret exists
- Whether caret was positioned
- Whether pendingCaret was cleared

#### Function: applyBlocks()
```typescript
console.log('🔴 applyBlocks START - input:', next.length, 'blocks');
const normalized = normalizeBlocks(next);
console.log('🔴 normalizeBlocks returned:', normalized.length, 'blocks');
const didChange = JSON.stringify(normalized) !== JSON.stringify(next);
console.log('🔴 did normalizeBlocks change structure?', didChange);
console.log('🔴 about to call setBlocks');
setBlocks(normalized);
const joined = joinDynamicTemplateBlocks(normalized);
console.log('🔴 about to call onChange with joined value, length:', joined.length);
onChange(joined);
console.log('🔴 applyBlocks END');
```

**What it tracks:**
- applyBlocks execution sequence
- Block normalization in applyBlocks
- onChange call with value length

#### Function: handleInsertTable()
```typescript
console.log('🟣 handleInsertTable START');
// ...
console.log('🟣 before.length:', before.length, 'after.length:', after.length);
// ...
console.log('🟣 pendingCaret set to:', { blockIndex: tableIndex + 1, position: 0 });
const newBlocks = [...];
console.log('🟣 newBlocks.length:', newBlocks.length, 'blocks.length was:', blocks.length);
console.log('🟣 calling applyBlocks');
applyBlocks(newBlocks);
// ...
console.log('🟣 handleInsertTable END');
```

**What it tracks:**
- Table insertion sequence
- Block structure changes
- When applyBlocks is called

---

## Log Color Code Guide

| Color | Component | What It Represents |
|-------|-----------|-------------------|
| 🟠 Orange | LetterTemplatesViewer | Parent component renders and onChange calls |
| 🔵 Blue | PaginatedTemplateEditor | Main effect that syncs value and onChange |
| 🟡 Yellow | PaginatedTemplateEditor | Effect that handles block changes |
| 🟢 Green | PaginatedTemplateEditor | Effect that handles caret positioning |
| 🔴 Red | PaginatedTemplateEditor | applyBlocks function (called when table inserted) |
| 🟣 Purple | PaginatedTemplateEditor | handleInsertTable function |

---

## How to Read the Logs

### Expected Sequence (Without Error)
```
🟣 handleInsertTable START
🟣 newBlocks.length: X blocks.length was: Y
🟣 calling applyBlocks
🔴 applyBlocks START - input: X blocks
🔴 normalizeBlocks returned: X blocks
🔴 about to call onChange
🟠 [LetterTemplatesViewer] RENDER #2
🟠 onChange callback FIRED - content length: Z
🔵 [useEffect value,onChange] FIRE - value.length: Z
🔵 normalizedValue.length: Z value.length: Z equal? true
🔵 ✓ NOT calling onChange - values are equal
🟡 [useLayoutEffect blocks] FIRE
✓ SUCCESS - No React error
```

### Expected Sequence (If Error Occurs)
```
🟣 handleInsertTable START
🔴 applyBlocks START
🔴 applyBlocks END
🟠 [LetterTemplatesViewer] RENDER #2
🟠 onChange callback FIRED
🔵 [useEffect value,onChange] FIRE #1
🔵 ⚠️ CALLING onChange - normalized !== original  ← LOOP STARTS HERE
🟠 [LetterTemplatesViewer] RENDER #3
🟠 onChange callback FIRED again (with same content)
🔵 [useEffect value,onChange] FIRE #2
🔵 ⚠️ CALLING onChange again
🟠 [LetterTemplatesViewer] RENDER #4
... repeats until React error #185
```

---

## Critical Observations to Make

1. **Count parent renders** - How many 🟠 lines appear?
2. **Check value equality** - Does "equal? true" ever appear, or always "equal? false"?
3. **Monitor applyBlocks frequency** - How many 🔴 START/END pairs?
4. **Track onChange calls** - From which functions is onChange called?
5. **Verify pendingCaret** - Is pendingCaret being cleared properly?

---

## After Reproduction

Take a screenshot of the console and note:
1. The exact sequence of colors (which effects/functions fire)
2. Any values that differ on each iteration
3. Which value keeps changing that shouldn't

This will reveal the root cause.
