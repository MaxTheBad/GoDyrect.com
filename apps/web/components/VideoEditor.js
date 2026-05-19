'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

const TRANSITIONS = [
  { value: 'none', label: 'None' },
  { value: 'cut', label: 'Cut' },
  { value: 'crossfade', label: 'Crossfade' },
];

function createOverlay(id) {
  return {
    id,
    text: 'Tap to edit',
    x: 50,
    y: 72,
    startTime: 0,
    endTime: 3,
  };
}

export default function VideoEditor({ onChange }) {
  const [clips, setClips] = useState([]);
  const [textOverlays, setTextOverlays] = useState([]);
  const [transitionType, setTransitionType] = useState('crossfade');
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);
  const [currentClipUrl, setCurrentClipUrl] = useState('');
  const [previewFrameUrl, setPreviewFrameUrl] = useState('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState('');
  const [thumbnailTime, setThumbnailTime] = useState(0.45);
  const [isMobile, setIsMobile] = useState(false);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const previewRef = useRef(null);
  const dragStateRef = useRef(null);

  useEffect(() => {
    let total = 0;
    clips.forEach((clip) => {
      total += clip.trimEnd || clip.duration || 0;
    });
    setDuration(total);
  }, [clips]);

  useEffect(() => {
    const sync = () => setIsMobile(window.innerWidth < 900);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  useEffect(() => {
    if (activeClipIndex > Math.max(0, clips.length - 1)) {
      setActiveClipIndex(Math.max(0, clips.length - 1));
    }
  }, [activeClipIndex, clips.length]);

  useEffect(() => {
    if (!clips.length) {
      setActiveClipIndex(0);
      setSelectedOverlayId(null);
    }
  }, [clips.length]);

  useEffect(() => {
    const clip = clips[activeClipIndex];
    if (!clip?.file) {
      setCurrentClipUrl('');
      setPreviewFrameUrl('');
      setThumbnailDataUrl('');
      setThumbnailTime(0.45);
      return undefined;
    }
    const url = URL.createObjectURL(clip.file);
    setCurrentClipUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [activeClipIndex, clips]);

  useEffect(() => {
    if (!currentClipUrl) {
      setPreviewFrameUrl('');
      return undefined;
    }

    const video = videoRef.current;
    if (!video) return undefined;
    let cancelled = false;
    const canvas = document.createElement('canvas');

    const capture = () => {
      const width = video.videoWidth || 720;
      const height = video.videoHeight || 1280;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      try {
        ctx.drawImage(video, 0, 0, width, height);
        const next = canvas.toDataURL('image/jpeg', 0.84);
        if (!cancelled && next) setPreviewFrameUrl(next);
      } catch {
        if (!cancelled) setPreviewFrameUrl('');
      }
    };

    const onLoaded = () => {
      try {
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        const target = Math.min(0.45, Math.max(0.08, video.duration * 0.08));
        video.currentTime = target;
        setThumbnailTime(target);
      } catch {
        setPreviewFrameUrl('');
      }
    };

    const onSeeked = () => capture();
    const onError = () => {
      if (!cancelled) setPreviewFrameUrl('');
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    if (video.readyState >= 1) onLoaded();

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
  }, [currentClipUrl]);

  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current;
    if (!video) return;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }, [currentClipUrl, playing]);

  function loadDuration(item, idx) {
    const url = URL.createObjectURL(item.file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = url;
    v.onloadedmetadata = () => {
      const dur = v.duration || 0;
      URL.revokeObjectURL(url);
      setClips((prev) => {
        const next = prev.slice();
        if (!next[idx]) return prev;
        next[idx] = { ...next[idx], duration: dur, trimEnd: dur };
        return next;
      });
    };
  }

  function addFiles(files) {
    const incoming = Array.from(files || []).map((file, i) => ({
      file,
      id: `${Date.now()}-${i}`,
      title: file.name,
      trimStart: 0,
      trimEnd: 0,
      duration: 0,
    }));
    if (!incoming.length) return;
    const next = clips.concat(incoming);
    setClips(next);
    incoming.forEach((item, idx) => loadDuration(item, clips.length + idx));
    setActiveClipIndex((current) => (current === 0 && clips.length === 0 ? 0 : current));
    propagate(next, textOverlays, transitionType);
  }

  function captureThumbnailFromFrame() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    const width = video.videoWidth || 720;
    const height = video.videoHeight || 1280;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      ctx.drawImage(video, 0, 0, width, height);
      const next = canvas.toDataURL('image/jpeg', 0.9);
      if (!next) return;
      setThumbnailDataUrl(next);
      setPreviewFrameUrl(next);
      propagate(clips, textOverlays, transitionType, next);
    } catch {}
  }

  function removeClip(idx) {
    const next = clips.slice();
    next.splice(idx, 1);
    setClips(next);
    setActiveClipIndex((current) => {
      if (next.length === 0) return 0;
      return Math.min(current, next.length - 1);
    });
    propagate(next, textOverlays, transitionType);
  }

  function moveClip(from, to) {
    if (from === to || from < 0 || to < 0 || from >= clips.length || to >= clips.length) return;
    const next = clips.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setClips(next);
    setActiveClipIndex(to);
    propagate(next, textOverlays, transitionType);
  }

  function addTextOverlay() {
    const overlay = createOverlay(Date.now());
    const next = textOverlays.concat(overlay);
    setTextOverlays(next);
    setSelectedOverlayId(overlay.id);
    propagate(clips, next, transitionType);
  }

  function openFilePicker() {
    const input = fileInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {}
    }
    input.click();
  }

  function updateOverlay(id, data) {
    const next = textOverlays.map((overlay) => (overlay.id === id ? { ...overlay, ...data } : overlay));
    setTextOverlays(next);
    propagate(clips, next, transitionType);
  }

  function removeOverlay(id) {
    const next = textOverlays.filter((overlay) => overlay.id !== id);
    setTextOverlays(next);
    if (selectedOverlayId === id) setSelectedOverlayId(null);
    propagate(clips, next, transitionType);
  }

  function changeTransition(nextTransition) {
    setTransitionType(nextTransition);
    propagate(clips, textOverlays, nextTransition);
  }

  function seekThumbnail(seconds) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(seconds)) return;
    try {
      video.currentTime = seconds;
      setThumbnailTime(seconds);
      setPlaying(false);
      video.pause();
      const canvas = document.createElement('canvas');
      const width = video.videoWidth || 720;
      const height = video.videoHeight || 1280;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      setTimeout(() => {
        try {
          ctx.drawImage(video, 0, 0, width, height);
          const next = canvas.toDataURL('image/jpeg', 0.9);
          if (next) {
            setThumbnailDataUrl(next);
            setPreviewFrameUrl(next);
            propagate(clips, textOverlays, transitionType, next);
          }
        } catch {}
      }, 120);
    } catch {}
  }

  function propagate(nextClips, overlays, nextTransition, nextThumbnail = thumbnailDataUrl) {
    if (!onChange) return;
    const manifest = {
      created_at: new Date().toISOString(),
      clips: nextClips.map((clip, index) => ({
        id: clip.id,
        name: clip.file.name,
        index,
        trimStart: clip.trimStart || 0,
        trimEnd: clip.trimEnd || clip.duration || 0,
      })),
      textOverlays: overlays,
      transition: {
        type: nextTransition,
        duration: nextTransition === 'crossfade' ? 0.35 : 0,
      },
    };
    onChange({
      clips: nextClips.map((clip) => clip.file),
      manifest,
      thumbnailDataUrl: nextThumbnail || '',
    });
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video || !clips.length) return;
    if (playing) {
      video.pause();
      setPlaying(false);
      return;
    }
    video.play();
    setPlaying(true);
  }

  function onTimeUpdate(event) {
    setPlayhead(event.target.currentTime);
  }

  function seekTo(seconds) {
    const video = videoRef.current;
    if (!video || !clips.length) return;
    video.currentTime = seconds;
    setPlayhead(seconds);
  }

  function handleEnded() {
    if (activeClipIndex < clips.length - 1) {
      setActiveClipIndex((current) => Math.min(current + 1, clips.length - 1));
      setPlayhead(0);
      return;
    }
    setPlaying(false);
  }

  function onPreviewPointerDown(event, overlay) {
    if (!previewRef.current) return;
    event.preventDefault();
    const rect = previewRef.current.getBoundingClientRect();
    dragStateRef.current = {
      overlayId: overlay.id,
      offsetX: event.clientX - rect.left - overlay.x,
      offsetY: event.clientY - rect.top - overlay.y,
    };
    setSelectedOverlayId(overlay.id);
    window.addEventListener('pointermove', onPreviewPointerMove);
    window.addEventListener('pointerup', onPreviewPointerUp);
  }

  function onPreviewPointerMove(event) {
    if (!dragStateRef.current || !previewRef.current) return;
    const { overlayId, offsetX, offsetY } = dragStateRef.current;
    const rect = previewRef.current.getBoundingClientRect();
    const x = Math.max(10, Math.min(rect.width - 120, event.clientX - rect.left - offsetX));
    const y = Math.max(10, Math.min(rect.height - 60, event.clientY - rect.top - offsetY));
    updateOverlay(overlayId, { x, y });
  }

  function onPreviewPointerUp() {
    dragStateRef.current = null;
    window.removeEventListener('pointermove', onPreviewPointerMove);
    window.removeEventListener('pointerup', onPreviewPointerUp);
  }

  const currentClip = clips[activeClipIndex];
  const currentTimeLabel = useMemo(() => `${Math.round(playhead * 10) / 10}s`, [playhead]);

  return (
    <div style={shell}>
      <div style={header}>
        <div>
          <div style={eyebrow}>Video Editor</div>
          <h2 style={title}>Build a short-form cut</h2>
          <p style={subtitle}>Add clips, choose a transition between them, and drag text around the frame.</p>
        </div>
        <div style={actions}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,image/*"
            onChange={(e) => addFiles(e.target.files)}
            style={hiddenInput}
          />
          <button type="button" onClick={openFilePicker} style={primaryBtn}>Add clips</button>
          <button type="button" onClick={addTextOverlay} style={secondaryBtn}>Add text</button>
        </div>
      </div>

      <div style={isMobile ? workspaceMobile : workspace}>
        <div style={previewPane}>
      <div style={isMobile ? previewFrameMobile : previewFrame} ref={previewRef}>
            {currentClip ? (
              <>
                <video
                  key={currentClip.id}
                  ref={videoRef}
                  style={video}
                  src={currentClipUrl}
                  onTimeUpdate={onTimeUpdate}
                  onEnded={handleEnded}
                  playsInline
                  controls={false}
                  muted
                />
                <div style={gradientOverlay} />
                {!playing ? <div style={tapToPlayBadge}>Tap to play</div> : null}
                {textOverlays.map((overlay) => (
                  <button
                    key={overlay.id}
                    type="button"
                    onPointerDown={(event) => onPreviewPointerDown(event, overlay)}
                    onClick={() => setSelectedOverlayId(overlay.id)}
                    style={{
                      ...overlayChip,
                      left: overlay.x,
                      top: overlay.y,
                      borderColor: selectedOverlayId === overlay.id ? '#ffffff' : 'rgba(255,255,255,0.2)',
                      boxShadow: selectedOverlayId === overlay.id ? '0 10px 24px rgba(0,0,0,0.28)' : 'none',
                    }}
                  >
                    {overlay.text}
                  </button>
                ))}
                <div style={playControls}>
                  <button type="button" onClick={togglePlay} style={playBtn}>{playing ? 'Pause' : 'Play'}</button>
                  <div style={timePill}>{currentTimeLabel}</div>
                </div>
              </>
            ) : (
              <div style={isMobile ? emptyStateMobile : emptyState}>
                <div style={emptyIcon}>+</div>
                <div style={emptyText}>Drop in a clip to start editing.</div>
                <button type="button" onClick={openFilePicker} style={primaryBtn}>Add your first clip</button>
              </div>
            )}
          </div>
        </div>

        <div style={isMobile ? sidebarMobile : sidebar}>
          <section style={panel}>
            <div style={panelHeader}>
              <div style={panelLabel}>Clips</div>
              <div style={smallMuted}>{clips.length} total</div>
            </div>
            <div style={clipRail}>
              {clips.map((clip, idx) => (
                <React.Fragment key={clip.id}>
                  <div
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', String(idx))}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = Number(e.dataTransfer.getData('text/plain'));
                      moveClip(from, idx);
                    }}
                    onClick={() => setActiveClipIndex(idx)}
                    style={{
                      ...clipCard,
                      ...(idx === activeClipIndex ? clipCardActive : null),
                    }}
                  >
                    <div style={clipHeaderRow}>
                      <div>
                        <div style={clipName}>{clip.title}</div>
                        <div style={clipMeta}>{Math.round((clip.duration || 0) * 10) / 10}s</div>
                      </div>
                      <div style={clipIndexPill}>
                        {idx + 1}
                      </div>
                    </div>
                    <div style={clipActions}>
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveClip(idx, idx - 1); }} style={miniBtn} disabled={idx === 0}>Up</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveClip(idx, idx + 1); }} style={miniBtn} disabled={idx === clips.length - 1}>Down</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removeClip(idx); }} style={miniDangerBtn}>Remove</button>
                    </div>
                  </div>
                  {idx < clips.length - 1 ? (
                    <div style={inlineTransitionWrap}>
                      <div style={inlineTransitionLabel}>Transition</div>
                      <div style={transitionRow}>
                        {TRANSITIONS.map((transition) => (
                          <button
                            key={transition.value}
                            type="button"
                            onClick={() => changeTransition(transition.value)}
                            style={{
                              ...chip,
                              ...(transitionType === transition.value ? chipActive : null),
                            }}
                          >
                            {transition.label}
                          </button>
                        ))}
                      </div>
                      <div style={hint}>Choose what happens between clips.</div>
                    </div>
                  ) : null}
                </React.Fragment>
              ))}
              {!clips.length ? <div style={hint}>Add clips, then drag them into order. Transitions live between each clip.</div> : null}
            </div>
          </section>

          <section style={panel}>
            <div style={panelHeader}>
              <div style={panelLabel}>Text</div>
              <button type="button" onClick={addTextOverlay} style={miniAccentBtn}>Add</button>
            </div>
            <div style={overlayList}>
              {textOverlays.map((overlay) => (
                <div key={overlay.id} style={overlayCard}>
                  <input
                    value={overlay.text}
                    onChange={(e) => updateOverlay(overlay.id, { text: e.target.value })}
                    style={overlayInput}
                  />
                  <div style={overlayMeta}>
                    <label style={fieldLabel}>
                      X
                      <input
                        type="number"
                        value={Math.round(overlay.x)}
                        onChange={(e) => updateOverlay(overlay.id, { x: Number(e.target.value) || 0 })}
                        style={smallInput}
                      />
                    </label>
                    <label style={fieldLabel}>
                      Y
                      <input
                        type="number"
                        value={Math.round(overlay.y)}
                        onChange={(e) => updateOverlay(overlay.id, { y: Number(e.target.value) || 0 })}
                        style={smallInput}
                      />
                    </label>
                  </div>
                  <button type="button" onClick={() => removeOverlay(overlay.id)} style={miniDangerBtn}>Delete text</button>
                </div>
              ))}
              {!textOverlays.length ? <div style={hint}>Add a caption or title, then drag it on the preview.</div> : null}
            </div>
          </section>

          <section style={panel}>
            <div style={panelHeader}>
              <div style={panelLabel}>Thumbnail</div>
            </div>
            <div style={hint}>Slide to the frame you want shown before play. This is what mobile will use first.</div>
            <div style={thumbnailScrubWrap}>
              <input
                type="range"
                min="0"
                max={Math.max(0.1, currentClip?.duration || 10)}
                step="0.1"
                value={Math.min(thumbnailTime, Math.max(0.1, currentClip?.duration || 10))}
                onChange={(e) => seekThumbnail(Number(e.target.value))}
                style={thumbnailScrub}
                disabled={!clips.length}
              />
              <div style={thumbnailScrubLabel}>{Math.round(thumbnailTime * 10) / 10}s</div>
            </div>
            <div style={thumbnailPreviewWrap}>
              {thumbnailDataUrl ? <img src={thumbnailDataUrl} alt='Selected thumbnail' style={thumbnailPreview} /> : <div style={thumbnailEmpty}>No thumbnail selected yet.</div>}
            </div>
            <button type="button" onClick={captureThumbnailFromFrame} style={miniAccentBtn} disabled={!clips.length}>
              Use current frame
            </button>
          </section>
        </div>
      </div>

      <div style={timelineWrap}>
        <div style={timelineTrack} onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seekTo(pct * Math.max(1, duration));
        }}>
          <div style={{ ...timelineFill, width: `${(playhead / Math.max(1, duration)) * 100}%` }} />
          <div style={{ ...timelineHead, left: `${(playhead / Math.max(1, duration)) * 100}%` }} />
        </div>
        <div style={timelineLabel}>{currentTimeLabel} / {Math.round(duration * 10) / 10 || 0}s</div>
      </div>

    </div>
  );
}

const shell = {
  display: 'grid',
  gap: 16,
  color: '#e5eefc',
};
const header = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'end',
  flexWrap: 'wrap',
};
const eyebrow = {
  fontSize: 12,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#7da8ff',
};
const title = {
  margin: '6px 0 6px',
  fontSize: 28,
  lineHeight: 1.1,
  color: '#ffffff',
};
const subtitle = {
  margin: 0,
  maxWidth: 620,
  color: '#a8b7d6',
};
const actions = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
};
const hiddenInput = { display: 'none' };
const primaryBtn = {
  border: 0,
  borderRadius: 999,
  background: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 50%, #8134af 100%)',
  color: '#fff',
  padding: '11px 16px',
  fontWeight: 700,
  cursor: 'pointer',
};
const secondaryBtn = {
  border: '1px solid rgba(134,160,215,0.35)',
  borderRadius: 999,
  background: 'rgba(10, 16, 34, 0.72)',
  color: '#e5eefc',
  padding: '11px 16px',
  fontWeight: 700,
  cursor: 'pointer',
};
const workspace = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.35fr) minmax(280px, 0.75fr)',
  gap: 16,
  alignItems: 'start',
};
const workspaceMobile = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 16,
  alignItems: 'start',
};
const previewPane = {
  background: 'radial-gradient(circle at top, rgba(61, 92, 169, 0.25), rgba(5, 10, 22, 0.95))',
  border: '1px solid rgba(125, 168, 255, 0.14)',
  borderRadius: 24,
  padding: 14,
  boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
};
const previewFrame = {
  position: 'relative',
  width: '100%',
  aspectRatio: '9 / 16',
  maxHeight: 760,
  borderRadius: 20,
  overflow: 'hidden',
  background: '#020617',
  border: '1px solid rgba(255,255,255,0.08)',
};
const previewFrameMobile = {
  ...previewFrame,
  aspectRatio: '4 / 5',
  maxHeight: '58vh',
};
const video = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};
const previewPreview = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};
const gradientOverlay = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.38) 100%)',
  pointerEvents: 'none',
};
const overlayChip = {
  position: 'absolute',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 16,
  padding: '10px 14px',
  background: 'rgba(13, 18, 30, 0.66)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'grab',
  userSelect: 'none',
  backdropFilter: 'blur(10px)',
};
const playControls = {
  position: 'absolute',
  left: 14,
  right: 14,
  bottom: 14,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  pointerEvents: 'none',
};
const tapToPlayBadge = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 3,
  padding: '10px 14px',
  borderRadius: 999,
  background: 'rgba(15, 23, 42, 0.68)',
  border: '1px solid rgba(255,255,255,0.16)',
  color: '#fff',
  fontWeight: 700,
  pointerEvents: 'none',
};
const playBtn = {
  border: 0,
  borderRadius: 999,
  padding: '10px 14px',
  background: 'rgba(255,255,255,0.9)',
  color: '#0f172a',
  fontWeight: 800,
  cursor: 'pointer',
  pointerEvents: 'auto',
};
const timePill = {
  borderRadius: 999,
  padding: '8px 12px',
  background: 'rgba(15, 23, 42, 0.65)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
};
const emptyState = {
  width: '100%',
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  gap: 14,
  textAlign: 'center',
  padding: 32,
  color: '#c5d3ef',
};
const emptyStateMobile = {
  ...emptyState,
  height: '56vh',
  minHeight: 420,
};
const emptyIcon = {
  width: 84,
  height: 84,
  borderRadius: 28,
  display: 'grid',
  placeItems: 'center',
  fontSize: 42,
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
};
const emptyText = {
  maxWidth: 280,
  fontSize: 17,
  lineHeight: 1.4,
};
const sidebar = {
  display: 'grid',
  gap: 14,
};
const sidebarMobile = {
  ...sidebar,
  position: 'static',
};
const panel = {
  borderRadius: 20,
  background: 'rgba(8, 13, 27, 0.78)',
  border: '1px solid rgba(125, 168, 255, 0.14)',
  padding: 14,
  boxShadow: '0 18px 40px rgba(0,0,0,0.18)',
};
const panelLabel = {
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 800,
  marginBottom: 10,
};
const panelHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};
const smallMuted = {
  color: '#9bb0d3',
  fontSize: 12,
};
const transitionRow = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};
const chip = {
  borderRadius: 999,
  border: '1px solid rgba(125, 168, 255, 0.22)',
  background: 'rgba(255,255,255,0.03)',
  color: '#d6e2fb',
  padding: '8px 12px',
  cursor: 'pointer',
  fontWeight: 700,
};
const chipActive = {
  background: 'rgba(46, 125, 255, 0.2)',
  borderColor: 'rgba(46, 125, 255, 0.7)',
  color: '#fff',
};
const hint = {
  marginTop: 10,
  color: '#8fa2c8',
  fontSize: 13,
  lineHeight: 1.45,
};
const clipRail = {
  display: 'grid',
  gap: 10,
};
const clipHeaderRow = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};
const clipCard = {
  borderRadius: 16,
  border: '1px solid rgba(125, 168, 255, 0.16)',
  background: 'rgba(255,255,255,0.03)',
  padding: 12,
  color: '#fff',
  cursor: 'pointer',
};
const clipCardActive = {
  borderColor: 'rgba(46, 125, 255, 0.82)',
  boxShadow: '0 0 0 1px rgba(46, 125, 255, 0.24) inset',
};
const clipName = {
  fontSize: 14,
  fontWeight: 800,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const clipMeta = {
  marginTop: 4,
  color: '#9bb0d3',
  fontSize: 12,
};
const clipIndexPill = {
  minWidth: 28,
  height: 28,
  padding: '0 8px',
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(46,125,255,0.14)',
  color: '#bcd4ff',
  border: '1px solid rgba(46,125,255,0.38)',
  fontSize: 12,
  fontWeight: 800,
  flexShrink: 0,
};
const clipActions = {
  display: 'flex',
  gap: 8,
  marginTop: 10,
  flexWrap: 'wrap',
};
const inlineTransitionWrap = {
  borderRadius: 16,
  border: '1px solid rgba(46,125,255,0.16)',
  background: 'rgba(255,255,255,0.02)',
  padding: 12,
  marginLeft: 12,
  marginRight: 12,
  display: 'grid',
  gap: 8,
};
const inlineTransitionLabel = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: '#7da8ff',
  fontWeight: 800,
};
const miniBtn = {
  border: '1px solid rgba(125, 168, 255, 0.18)',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.04)',
  color: '#e5eefc',
  padding: '7px 10px',
  cursor: 'pointer',
};
const miniDangerBtn = {
  ...miniBtn,
  borderColor: 'rgba(255, 126, 126, 0.3)',
  color: '#ffb7b7',
};
const miniAccentBtn = {
  ...miniBtn,
  borderColor: 'rgba(46, 125, 255, 0.42)',
  color: '#bcd4ff',
};
const overlayList = {
  display: 'grid',
  gap: 10,
};
const overlayCard = {
  display: 'grid',
  gap: 10,
  padding: 12,
  borderRadius: 16,
  border: '1px solid rgba(125, 168, 255, 0.12)',
  background: 'rgba(255,255,255,0.03)',
};
const thumbnailPreviewWrap = {
  minHeight: 180,
  borderRadius: 16,
  border: '1px dashed rgba(125, 168, 255, 0.22)',
  background: 'rgba(255,255,255,0.02)',
  overflow: 'hidden',
  display: 'grid',
  placeItems: 'center',
};
const thumbnailScrubWrap = {
  display: 'grid',
  gap: 8,
};
const thumbnailScrub = {
  width: '100%',
  accentColor: '#2e7dff',
};
const thumbnailScrubLabel = {
  color: '#9bb0d3',
  fontSize: 12,
};
const thumbnailPreview = {
  width: '100%',
  height: 180,
  objectFit: 'cover',
  display: 'block',
};
const thumbnailEmpty = {
  color: '#8fa2c8',
  fontSize: 13,
  padding: 16,
  textAlign: 'center',
};
const overlayInput = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid rgba(125, 168, 255, 0.2)',
  background: 'rgba(2, 6, 23, 0.85)',
  color: '#fff',
  padding: '10px 12px',
};
const overlayMeta = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
};
const fieldLabel = {
  display: 'grid',
  gap: 6,
  fontSize: 12,
  color: '#9bb0d3',
};
const smallInput = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid rgba(125, 168, 255, 0.2)',
  background: 'rgba(2, 6, 23, 0.85)',
  color: '#fff',
  padding: '9px 10px',
};
const timelineWrap = {
  display: 'grid',
  gap: 10,
  padding: 14,
  borderRadius: 18,
  background: 'rgba(8, 13, 27, 0.76)',
  border: '1px solid rgba(125, 168, 255, 0.14)',
};
const timelineTrack = {
  position: 'relative',
  height: 10,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.08)',
  cursor: 'pointer',
};
const timelineFill = {
  height: '100%',
  borderRadius: 999,
  background: 'linear-gradient(90deg, #2e7dff, #dd2a7b)',
};
const timelineHead = {
  position: 'absolute',
  top: '50%',
  width: 16,
  height: 16,
  borderRadius: 999,
  background: '#fff',
  transform: 'translate(-50%, -50%)',
  boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
};
const timelineLabel = {
  fontSize: 13,
  color: '#a8b7d6',
};
