'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export function FeedPost({
  listing,
  businessName,
  businessLocation,
  sellerName,
  media = [],
  activeIndex = 0,
  onPrev,
  onNext,
  onPick,
  onOpen,
  isFavorite = false,
  onToggleFavorite,
  onToggleSellerFollow,
  onToggleBusinessFollow,
  onEdit,
}) {
  const activeMedia = media[activeIndex] || media[0];
  const mediaCount = media.length;
  const videoRef = useRef(null);
  const [showActions, setShowActions] = useState(false);
  const [mediaProgress, setMediaProgress] = useState(0);
  const [showPlayer, setShowPlayer] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const poster = activeMedia?.thumbnail_url || listing?.thumbnail_url || '';
  const fallbackVisual = poster || buildFallbackPoster(listing.title, businessName);

  return (
    <article style={postShell}>
      <div style={postTopRow}>
        <div style={avatar}>{(listing.title || 'B').slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={postMeta}>
            <span style={postBusiness}>{businessName || listing.category || 'Listing'}</span>
            <span>·</span>
            <span>Posted by {sellerName || 'User'}</span>
            <span>·</span>
            <span>{listing.lister_role || 'Authorized Representative'}</span>
          </div>
          <div style={postLocation}>{[listing.city, listing.state].filter(Boolean).join(', ') || businessLocation || 'Location not set'}</div>
        </div>
        <div style={postActions}>
          <button type='button' aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'} onClick={onToggleFavorite} style={bookmarkBtn(isFavorite)}>
            <span style={bookmarkIcon(isFavorite)}>
              {isFavorite ? (
                <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false' style={{ width: 20, height: 20, display: 'block', fill: 'currentColor' }}>
                  <path d='M6 3.75h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.75a1 1 0 0 1 1-1Z' />
                </svg>
              ) : (
                <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false' style={{ width: 20, height: 20, display: 'block', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                  <path d='M6 3.75h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.75a1 1 0 0 1 1-1Z' />
                </svg>
              )}
            </span>
          </button>
          <div style={{ position: 'relative' }}>
            <button type='button' style={menuBtn} aria-label='Open actions' onClick={() => setShowActions((v) => !v)}>⋯</button>
            {showActions ? (
              <div style={menuPanel}>
                <button type='button' onClick={() => { onToggleFavorite?.(); setShowActions(false); }} style={menuItem}>{isFavorite ? '★ Saved' : '☆ Favorite'}</button>
                {onToggleSellerFollow ? <button type='button' onClick={() => { onToggleSellerFollow(); setShowActions(false); }} style={menuItem}>Follow Seller</button> : null}
                {onToggleBusinessFollow ? <button type='button' onClick={() => { onToggleBusinessFollow(); setShowActions(false); }} style={menuItem}>Follow Business</button> : null}
                <a href={onOpen} style={menuLink}>View</a>
                {onEdit ? <button type='button' onClick={() => { onEdit(); setShowActions(false); }} style={menuItem}>Edit</button> : <a href={`/messages?seller=${listing.seller_id}&listing=${listing.id}`} style={menuLink}>Message</a>}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {activeMedia ? (
        <div style={heroMediaFrame}>
          <div style={mediaTitleOverlay}>
            <div style={mediaTitle}>{listing.title}</div>
          </div>
          {activeMedia.media_type === 'video' ? (
            <>
              <video
                ref={videoRef}
                src={activeMedia.url}
                poster={fallbackVisual}
                playsInline
                controls={false}
                preload='auto'
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.paused) {
                    void video.play().then(() => setIsPlaying(true)).catch(() => {});
                  } else {
                    video.pause();
                    setIsPlaying(false);
                  }
                }}
                onTimeUpdate={() => {
                  const video = videoRef.current;
                  if (!video?.duration) return;
                  setMediaProgress((video.currentTime / video.duration) * 100);
                }}
                onLoadedMetadata={() => {
                  const video = videoRef.current;
                  if (!video?.duration) return;
                  setMediaProgress((video.currentTime / video.duration) * 100);
                }}
                onCanPlay={() => setVideoReady(true)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                style={heroMediaAsset}
              />
              <button
                type='button'
                aria-label='Play video'
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  void video.play().then(() => setIsPlaying(true)).catch(() => {});
                }}
                style={{ ...videoCoverButton, opacity: isPlaying ? 0 : 1, pointerEvents: isPlaying ? 'none' : 'auto' }}
              >
                <div style={videoCoverPill}>{videoReady ? 'Tap to play' : 'Loading video...'}</div>
              </button>
            </>
          ) : (
            <img src={activeMedia.thumbnail_url || activeMedia.url} alt='listing media' style={heroMediaAsset} />
          )}
          {activeMedia.media_type === 'video' ? (
            <input
              type='range'
              min='0'
              max='100'
              step='0.1'
              value={mediaProgress}
              onChange={(e) => {
                const video = videoRef.current;
                if (!video?.duration) return;
                const next = Number(e.target.value);
                video.currentTime = (next / 100) * video.duration;
                setMediaProgress(next);
              }}
              style={videoProgress}
            />
          ) : null}
          {activeMedia.media_type === 'video' ? (
            <button
              type='button'
              aria-label='Open full screen viewer'
              style={fullscreenBtn}
              onClick={() => setShowPlayer(true)}
            >
              ⤢
            </button>
          ) : null}
          {listing.description ? <div style={mediaCaption}>{listing.description}</div> : null}
          {mediaCount > 1 ? (
            <>
              <button type='button' aria-label='Previous media' style={carouselArrowLeft} onClick={onPrev}>‹</button>
              <button type='button' aria-label='Next media' style={carouselArrowRight} onClick={onNext}>›</button>
              <div style={carouselDots}>
                {media.map((m, idx) => (
                  <button
                    key={m.url + idx}
                    type='button'
                    aria-label={`Show media ${idx + 1} of ${mediaCount}`}
                    style={idx === activeIndex ? activeDot : dot}
                    onClick={() => onPick(idx)}
                  />
                ))}
              </div>
            </>
          ) : null}
          {showPlayer ? (
            <div style={playerModal} onClick={() => setShowPlayer(false)} role='presentation'>
              <div style={playerModalInner} onClick={(e) => e.stopPropagation()} role='presentation'>
                <button type='button' aria-label='Close viewer' style={closePlayerBtn} onClick={() => setShowPlayer(false)}>×</button>
                {activeMedia.media_type === 'video' ? (
                  <video
                    src={activeMedia.url}
                    poster={poster || undefined}
                    playsInline
                    controls
                    autoPlay
                    style={playerMedia}
                  />
                ) : (
                  <img src={activeMedia.thumbnail_url || activeMedia.url} alt='listing media' style={playerMedia} />
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function FeedEmptyState({ loading, msg, hasFollows, hasSearch = false, exploreHref = '/explore' }) {
  if (loading || msg) return null;

  if (!hasFollows) {
    return (
      <div style={emptyState}>
        <div>
          <h3 style={emptyTitle}>Your feed is empty</h3>
          <p style={emptyCopy}>Follow people or businesses to start seeing posts here, or jump into Explore to browse the marketplace.</p>
        </div>
        <div style={emptyActions}>
          <a href={exploreHref} style={primaryAction}>Explore listings</a>
          <a href='/businesses' style={secondaryAction}>Follow businesses</a>
        </div>
      </div>
    );
  }

  return (
    <div style={emptyState}>
      <div>
        <h3 style={emptyTitle}>{hasSearch ? 'No posts match your search' : 'No posts to show yet'}</h3>
        <p style={emptyCopy}>
          {hasSearch
            ? 'Try a different search term or open Explore for more listings and businesses.'
            : 'You’re following people or businesses, but nothing has been posted yet. Check Explore for more listings and businesses.'}
        </p>
      </div>
      <div style={emptyActions}>
        <a href={exploreHref} style={primaryAction}>Explore more</a>
      </div>
    </div>
  );
}

export function FeedHero({
  searchDraft,
  setSearchDraft,
  industry,
  setIndustry,
  onSearch,
  rowsCount,
  businessCount,
  peopleCount,
  compact = false,
}) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const sync = () => setIsMobile(window.innerWidth < 768);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const mobileHero = compact || isMobile;
  return (
    <section style={mobileHero ? compactHeroShell : heroShell}>
      <div style={heroOverlay} />
      <div style={mobileHero ? compactHeroContent : heroContent}>
        <div style={heroPanel}>
          <div style={mobileHero ? heroToplineMobile : heroTopline}>Discover deals, businesses, and brokers</div>
          <h1 style={mobileHero ? heroTitleMobile : heroTitle}>Find a business for sale</h1>
          <p style={mobileHero ? heroSubtitleMobile : heroSubtitle}>Search by business name, city, state, or ZIP. Keep your feed focused on what you actually want to buy.</p>

          <div style={heroSearchWrap}>
            <div style={heroTabs}>
              <button type='button' style={industry === 'all' ? activeTab : tabButton} onClick={() => setIndustry('all')}>Businesses</button>
              <button type='button' style={industry === 'startup' ? activeTab : tabButton} onClick={() => setIndustry('startup')}>Franchises</button>
            </div>

            <div style={mobileHero ? searchBarMobile : searchBar}>
              <div style={searchFieldWrap}>
                <label style={srOnly} htmlFor='feed-search'>Search</label>
                <input
                  id='feed-search'
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder='California, Miami, 33101, coffee shop...'
                  style={mobileHero ? searchInputMobile : searchInput}
                />
              </div>
              {mobileHero ? null : <div style={divider} />}
              <div style={searchFieldWrap}>
                <label style={srOnly} htmlFor='feed-industry'>Industry</label>
                <select id='feed-industry' value={industry} onChange={(e) => setIndustry(e.target.value)} style={mobileHero ? searchSelectMobile : searchSelect}>
                  <option value='all'>All Industries</option>
                  <option value='established'>Established Businesses</option>
                  <option value='asset_sale'>Asset Sales</option>
                  <option value='real_estate'>Real Estate</option>
                  <option value='startup'>Start-Ups</option>
                </select>
              </div>
              <button type='button' style={mobileHero ? searchBtnMobile : searchBtn} onClick={onSearch}>Search</button>
            </div>
          </div>

          <div style={mobileHero ? statsRowMobile : statsRow}>
            <div style={statCard}>
              <span style={statLabel}>Posts</span>
              <strong style={statValue}>{rowsCount.toLocaleString()}</strong>
            </div>
            <div style={statCard}>
              <span style={statLabel}>Businesses</span>
              <strong style={statValue}>{businessCount.toLocaleString()}</strong>
            </div>
            <div style={statCard}>
              <span style={statLabel}>People</span>
              <strong style={statValue}>{peopleCount.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export const heroShell = {
  position: 'relative',
  minHeight: '100vh',
  backgroundImage: "url('/bg.jpg')",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  overflow: 'hidden',
};
export const compactHeroShell = {
  ...heroShell,
  minHeight: 'auto',
  paddingBottom: 12,
};
export const heroOverlay = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(6,10,24,0.35) 0%, rgba(11,16,32,0.8) 52%, rgba(11,16,32,0.98) 100%)',
};
export const heroContent = { position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px 16px 24px' };
export const compactHeroContent = { ...heroContent, minHeight: 'auto', padding: '14px 12px 8px' };
export const heroPanel = { width: 'min(1080px, 100%)', display: 'grid', gap: 16, justifyItems: 'center', textAlign: 'center', padding: '20px 0 8px', border: 0, background: 'transparent', boxShadow: 'none' };
export const heroTopline = { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9fc0ff' };
export const heroToplineMobile = { ...heroTopline, fontSize: 11 };
export const heroTitle = { margin: 0, fontSize: 'clamp(40px, 7vw, 78px)', lineHeight: 0.95, fontWeight: 800, color: '#fff', textShadow: '0 8px 24px rgba(0,0,0,0.35)' };
export const heroTitleMobile = { ...heroTitle, fontSize: 'clamp(28px, 8vw, 42px)', lineHeight: 1.02 };
export const heroSubtitle = { margin: 0, maxWidth: 760, fontSize: 18, lineHeight: 1.5, color: 'rgba(235,241,255,0.88)' };
export const heroSubtitleMobile = { ...heroSubtitle, fontSize: 14, maxWidth: 560, lineHeight: 1.45 };
export const heroSearchWrap = { width: 'min(100%, 980px)', display: 'grid', gap: 14, justifyItems: 'center' };
export const heroTabs = { display: 'inline-flex', gap: 8, padding: 6, borderRadius: 999, background: 'rgba(12,18,39,0.72)', border: '1px solid rgba(94,128,202,0.34)' };
export const tabButton = { border: 0, borderRadius: 999, background: 'transparent', color: 'rgba(255,255,255,0.85)', padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
export const activeTab = { ...tabButton, background: '#ffffff', color: '#1457d6', boxShadow: '0 6px 16px rgba(0,0,0,0.18)' };
export const searchBar = { width: 'min(100%, 980px)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) 1px minmax(220px, 0.95fr) auto', alignItems: 'stretch', borderRadius: 18, overflow: 'hidden', background: '#fff', boxShadow: '0 18px 40px rgba(4, 10, 28, 0.24)' };
export const searchBarMobile = { width: 'min(100%, 980px)', display: 'grid', gridTemplateColumns: '1fr', alignItems: 'stretch', borderRadius: 18, overflow: 'hidden', background: '#fff', boxShadow: '0 18px 40px rgba(4, 10, 28, 0.24)' };
export const searchFieldWrap = { display: 'grid' };
export const divider = { width: 1, background: '#e1e7f2' };
export const searchInput = { width: '100%', border: 0, padding: '22px 20px', fontSize: 18, outline: 'none', color: '#0f172a' };
export const searchInputMobile = { ...searchInput, minHeight: 56, padding: '18px 18px', fontSize: 16 };
export const searchSelect = { width: '100%', border: 0, padding: '22px 18px', fontSize: 18, outline: 'none', color: '#334155', background: 'transparent' };
export const searchSelectMobile = { ...searchSelect, minHeight: 52, padding: '16px 18px', fontSize: 16, borderTop: '1px solid #e1e7f2' };
export const searchBtn = { border: '1px solid #2a3c78', background: '#2e7dff', color: '#fff', padding: '0 34px', fontSize: 18, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 20px rgba(46,125,255,0.28)' };
export const searchBtnMobile = { ...searchBtn, minHeight: 54, padding: '0 18px', fontSize: 16, borderRadius: 0 };
export const statsRow = { width: 'min(100%, 980px)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 };
export const statsRowMobile = { width: 'min(100%, 980px)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 10 };
export const statCard = { borderRadius: 18, padding: '14px 16px', background: 'rgba(12,18,39,0.66)', border: '1px solid rgba(94,128,202,0.28)', textAlign: 'left' };
export const statLabel = { display: 'block', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(159,192,255,0.92)' };
export const statValue = { display: 'block', marginTop: 8, fontSize: 24, color: '#fff' };
export const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };

const postShell = { color: '#fff', padding: 0 };
const postTopRow = { display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr) auto', gap: 14, alignItems: 'center', marginBottom: 10 };
const postActions = { display: 'flex', alignItems: 'center', gap: 10, position: 'relative' };
const avatar = { width: 42, height: 42, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #ffd6e8, #c7d6ff)', color: '#0f172a', fontWeight: 800, fontSize: 18 };
const postMeta = { display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.82)', alignItems: 'center' };
const postBusiness = { fontWeight: 700, color: '#fff' };
const postLocation = { marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.72)' };
const bookmarkBtn = (active) => ({
  width: 48,
  height: 48,
  borderRadius: 999,
  border: '1px solid rgba(215,219,229,0.9)',
  background: active ? 'rgba(46,125,255,0.14)' : '#fff',
  color: active ? '#2e7dff' : '#111827',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
});
const bookmarkIcon = (active) => ({ display: 'grid', placeItems: 'center', color: active ? '#2e7dff' : '#111827' });
const menuBtn = { border: '1px solid rgba(215,219,229,0.9)', borderRadius: 999, background: '#fff', color: '#111827', width: 48, height: 48, fontSize: 24, lineHeight: 1, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.08)' };
const menuPanel = { position: 'absolute', right: 0, top: 52, background: '#0f1732', border: '1px solid rgba(94,128,202,0.28)', borderRadius: 10, minWidth: 180, display: 'grid', zIndex: 5, boxShadow: '0 10px 24px rgba(0,0,0,0.2)' };
const menuItem = { border: 0, borderBottom: '1px solid rgba(94,128,202,0.18)', background: '#0f1732', textAlign: 'left', padding: '10px 12px', cursor: 'pointer', color: '#fff' };
const menuLink = { padding: '10px 12px', textDecoration: 'none', color: '#fff', borderBottom: '1px solid rgba(94,128,202,0.18)' };
const heroMediaFrame = {
  position: 'relative',
  width: 'min(100%, 470px)',
  aspectRatio: '9 / 16',
  maxHeight: '78vh',
  margin: '0 auto',
  borderRadius: 20,
  overflow: 'hidden',
  background: '#050a1a',
  border: '1px solid #e5e7eb',
};
const heroMediaAsset = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#050a1a' };
const videoCoverButton = { position: 'absolute', inset: 0, zIndex: 2, border: 0, padding: 0, margin: 0, background: 'linear-gradient(135deg, rgba(15,23,42,0.08) 0%, rgba(15,23,42,0.2) 100%)', display: 'grid', placeItems: 'center', cursor: 'pointer' };
const videoCoverPill = { padding: '10px 14px', borderRadius: 999, background: 'rgba(15,23,42,0.56)', border: '1px solid rgba(255,255,255,0.16)', color: '#fff', fontWeight: 700, letterSpacing: 0.2 };
const mediaTitleOverlay = { position: 'absolute', left: 0, right: 0, top: 0, padding: '10px 14px 0', zIndex: 2, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(5,10,26,0.86) 0%, rgba(5,10,26,0) 100%)' };
const mediaTitle = { color: '#fff', fontWeight: 800, fontSize: 16, lineHeight: 1.15, textShadow: '0 1px 2px rgba(0,0,0,0.5)' };
const mediaCaption = { position: 'absolute', left: 0, right: 0, bottom: 44, padding: '16px 16px 14px', fontSize: 14, lineHeight: 1.4, color: '#fff', background: 'linear-gradient(180deg, rgba(15,23,42,0) 0%, rgba(15,23,42,0.72) 100%)', textShadow: '0 1px 2px rgba(0,0,0,0.35)', whiteSpace: 'pre-wrap', pointerEvents: 'none', zIndex: 2 };
const carouselArrowBase = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: 999, border: 0, background: 'rgba(255,255,255,0.88)', color: '#111827', fontSize: 24, lineHeight: '30px', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.18)' };
const carouselArrowLeft = { ...carouselArrowBase, left: 10 };
const carouselArrowRight = { ...carouselArrowBase, right: 10 };
const carouselDots = { position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 999, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)' };
const dot = { width: 7, height: 7, borderRadius: 999, border: 0, background: 'rgba(255,255,255,0.45)', padding: 0, cursor: 'pointer' };
const activeDot = { ...dot, background: '#fff', width: 8, height: 8 };
const videoProgress = { position: 'absolute', left: 14, right: 14, bottom: 8, width: 'calc(100% - 28px)', accentColor: '#2e7dff', zIndex: 3 };
const fullscreenBtn = { position: 'absolute', right: 12, bottom: 30, width: 34, height: 34, borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(15,23,42,0.72)', color: '#fff', cursor: 'pointer', zIndex: 4, display: 'grid', placeItems: 'center', fontSize: 18, lineHeight: 1 };
const playerModal = { position: 'fixed', inset: 0, background: 'rgba(3,7,18,0.85)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 };
const playerModalInner = { position: 'relative', width: 'min(96vw, 720px)', borderRadius: 20, overflow: 'hidden', background: '#050a1a', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 30px 90px rgba(0,0,0,0.55)' };
const closePlayerBtn = { position: 'absolute', right: 10, top: 10, zIndex: 2, width: 34, height: 34, borderRadius: 999, border: 0, background: 'rgba(15,23,42,0.82)', color: '#fff', cursor: 'pointer', fontSize: 22, lineHeight: 1 };
const playerMedia = { width: '100%', height: 'auto', display: 'block', background: '#050a1a' };

function buildFallbackPoster(title, businessName) {
  const text = [title, businessName].filter(Boolean).join(' · ') || 'GoDyrect listing';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f1732"/>
        <stop offset="100%" stop-color="#1e3a8a"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#g)"/>
    <circle cx="640" cy="360" r="88" fill="rgba(255,255,255,0.12)"/>
    <polygon points="610,315 610,405 690,360" fill="#ffffff"/>
    <text x="640" y="510" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" text-anchor="middle">${escapeXml(text)}</text>
    <text x="640" y="560" fill="rgba(255,255,255,0.84)" font-family="Arial, Helvetica, sans-serif" font-size="22" text-anchor="middle">Tap to play</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
const emptyState = { marginTop: 12, padding: 18, borderRadius: 16, border: '1px solid rgba(94,128,202,0.28)', background: 'rgba(12,18,39,0.66)', display: 'grid', gap: 14, color: '#fff' };
const emptyTitle = { margin: 0, fontSize: 18 };
const emptyCopy = { margin: '6px 0 0', color: 'rgba(255,255,255,0.82)', lineHeight: 1.5 };
const emptyActions = { display: 'flex', gap: 10, flexWrap: 'wrap' };
const primaryAction = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '10px 14px', borderRadius: 10, background: '#2e7dff', color: '#fff', textDecoration: 'none', fontWeight: 700 };
const secondaryAction = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '10px 14px', borderRadius: 10, background: '#0e1738', color: '#fff', textDecoration: 'none', fontWeight: 700, border: '1px solid #304178' };
