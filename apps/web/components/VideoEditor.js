'use client';

import React, { useState, useRef } from 'react';

export default function VideoEditor({ onChange }) {
  const [clips, setClips] = useState([]);
  const [selectedClipIndex, setSelectedClipIndex] = useState(null);
  const [textOverlays, setTextOverlays] = useState([]);
  const [transitionType, setTransitionType] = useState('crossfade');
  const fileInputRef = useRef();

  function addFiles(files) {
    const arr = Array.from(files).map((f, i) => ({ file: f, id: Date.now() + i, title: f.name }));
    const next = clips.concat(arr);
    setClips(next);
    propagate(next, textOverlays, transitionType);
  }

  function removeClip(idx) {
    const next = clips.slice();
    next.splice(idx, 1);
    setClips(next);
    propagate(next, textOverlays, transitionType);
  }

  function moveClip(idx, dir) {
    const next = clips.slice();
    const [item] = next.splice(idx, 1);
    next.splice(idx + dir, 0, item);
    setClips(next);
    propagate(next, textOverlays, transitionType);
  }

  function addTextOverlay() {
    const overlay = { id: Date.now(), text: 'New text', x: 10, y: 10, startClip: 0, endClip: Math.max(0, clips.length - 1) };
    const next = textOverlays.concat(overlay);
    setTextOverlays(next);
    propagate(clips, next, transitionType);
  }

  function updateOverlay(id, data) {
    const next = textOverlays.map((o) => (o.id === id ? { ...o, ...data } : o));
    setTextOverlays(next);
    propagate(clips, next, transitionType);
  }

  function removeOverlay(id) {
    const next = textOverlays.filter((o) => o.id !== id);
    setTextOverlays(next);
    propagate(clips, next, transitionType);
  }

  function changeTransition(t) {
    setTransitionType(t);
    propagate(clips, textOverlays, t);
  }

  function propagate(c, o, t) {
    if (!onChange) return;
    // Build manifest with minimal shape
    const manifest = {
      created_at: new Date().toISOString(),
      clips: c.map((cItem, i) => ({ id: cItem.id, name: cItem.file.name, index: i })),
      textOverlays: o,
      transition: t,
    };
    onChange({ clips: c.map((cItem) => cItem.file), manifest });
  }

  // create a file input wrapper that allows adding files
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" onChange={(e) => addFiles(e.target.files)} />
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {clips.map((c, idx) => (
          <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, background: '#0e1738', borderRadius: 8 }}>
            <div style={{ flex: 1 }} onClick={() => setSelectedClipIndex(idx)}>
              <div style={{ fontSize: 13 }}>{c.title}</div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>{c.file.type}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => moveClip(idx, -1)} disabled={idx === 0} style={smallBtn}>↑</button>
              <button type="button" onClick={() => moveClip(idx, 1)} disabled={idx === clips.length - 1} style={smallBtn}>↓</button>
              <button type="button" onClick={() => removeClip(idx)} style={smallBtn}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={addTextOverlay} style={btn}>Add draggable text</button>
        <label style={{ color: '#fff' }}>Transition:</label>
        <select value={transitionType} onChange={(e) => changeTransition(e.target.value)} style={select}>
          <option value="crossfade">Crossfade</option>
          <option value="cut">Cut</option>
          <option value="fade">Fade to black</option>
        </select>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {textOverlays.map((o) => (
          <div key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#08102a', padding: 8, borderRadius: 8 }}>
            <input value={o.text} onChange={(e) => updateOverlay(o.id, { text: e.target.value })} style={inputSmall} />
            <label style={{ color: '#ccc', fontSize: 13 }}>x</label>
            <input type="number" value={o.x} onChange={(e) => updateOverlay(o.id, { x: Number(e.target.value) })} style={numInput} />
            <label style={{ color: '#ccc', fontSize: 13 }}>y</label>
            <input type="number" value={o.y} onChange={(e) => updateOverlay(o.id, { y: Number(e.target.value) })} style={numInput} />
            <button type="button" onClick={() => removeOverlay(o.id)} style={smallBtn}>Delete</button>
          </div>
        ))}
      </div>

      <div style={{ color: '#9fb7ff', fontSize: 13, opacity: 0.95 }}>Tip: This editor stores a project manifest alongside uploaded files. Final rendering is performed later by the server using the manifest.</div>
    </div>
  );
}

const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '8px 10px' };
const smallBtn = { border: 0, borderRadius: 6, background: '#21345a', color: '#fff', padding: '6px' };
const select = { background: '#07102a', color: '#fff', border: '1px solid #304178', padding: '8px', borderRadius: 8 };
const inputSmall = { background: '#07102a', color: '#fff', border: '1px solid #304178', padding: '6px', borderRadius: 6 };
const numInput = { width: 60, background: '#07102a', color: '#fff', border: '1px solid #304178', padding: '6px', borderRadius: 6 };
