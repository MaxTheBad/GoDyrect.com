'use client';

import { useMemo, useRef, useState } from 'react';

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

  return (
    <article style={postShell}>
      <div style={postTopRow}>
        <div style={avatar}>{(listing.title || 'B').slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={postTitle}>{listing.title}</div>
          <div style={postMeta}>
            <span style={postBusiness}>{businessName || 'Business'}</span>
            <span>·</span>
            <span>Posted by {sellerName || 'User'}</span>
            <span>·</span>
            <span>{listing.lister_role || 'Authorized Representative'}</span>
          </div>
          <div style={postLocation}>{[listing.city, listing.state].filter(Boolean).join(', ') || businessLocation || 'Location not set'}</div>
        </div>
        <div style={postActions}>
          <button type='button' aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'} onClick={onToggleFavorite} style={bookmarkBtn(isFavorite)}>
            <span style={bookmarkIcon(isFavorite)}>🔖</span>
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
          <a href={onOpen} style={openPill}>Open</a>
        </div>
      </div>

      {activeMedia ? (
        <div style={heroMediaFrame}>
          {activeMedia.media_type === 'video' ? (
            <video
              ref={videoRef}
              src={activeMedia.url}
              playsInline
              controls={false}
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) {
                  void video.play();
                } else {
                  video.pause();
                }
              }}
              onTimeUpdate={() => {
                const video = videoRef.current;
                if (!video?.duration) return;
                setMediaProgress((video.currentTime / video.duration) * 100);
              }}
              style={heroMediaAsset}
            />
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
  return (
    <section style={compact ? compactHeroShell : heroShell}>
      <div style={heroOverlay} />
      <div style={compact ? compactHeroContent : heroContent}>
        <div style={heroPanel}>
          <div style={heroTopline}>Discover deals, businesses, and brokers</div>
          <h1 style={heroTitle}>Find a business for sale</h1>
          <p style={heroSubtitle}>Search by business name, city, state, or ZIP. Keep your feed focused on what you actually want to buy.</p>

          <div style={heroSearchWrap}>
            <div style={heroTabs}>
              <button type='button' style={industry === 'all' ? activeTab : tabButton} onClick={() => setIndustry('all')}>Businesses</button>
              <button type='button' style={industry === 'startup' ? activeTab : tabButton} onClick={() => setIndustry('startup')}>Franchises</button>
            </div>

            <div style={searchBar}>
              <div style={searchFieldWrap}>
                <label style={srOnly} htmlFor='feed-search'>Search</label>
                <input
                  id='feed-search'
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder='California, Miami, 33101, coffee shop...'
                  style={searchInput}
                />
              </div>
              <div style={divider} />
              <div style={searchFieldWrap}>
                <label style={srOnly} htmlFor='feed-industry'>Industry</label>
                <select id='feed-industry' value={industry} onChange={(e) => setIndustry(e.target.value)} style={searchSelect}>
                  <option value='all'>All Industries</option>
                  <option value='established'>Established Businesses</option>
                  <option value='asset_sale'>Asset Sales</option>
                  <option value='real_estate'>Real Estate</option>
                  <option value='startup'>Start-Ups</option>
                </select>
              </div>
              <button type='button' style={searchBtn} onClick={onSearch}>Search</button>
            </div>
          </div>

          <div style={statsRow}>
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
export const heroContent = { position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 16px 32px' };
export const compactHeroContent = { ...heroContent, minHeight: 'auto', padding: '28px 16px 10px' };
export const heroPanel = { width: 'min(1080px, 100%)', display: 'grid', gap: 16, justifyItems: 'center', textAlign: 'center', padding: '20px 0 8px', border: 0, background: 'transparent', boxShadow: 'none' };
export const heroTopline = { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9fc0ff' };
export const heroTitle = { margin: 0, fontSize: 'clamp(40px, 7vw, 78px)', lineHeight: 0.95, fontWeight: 800, color: '#fff', textShadow: '0 8px 24px rgba(0,0,0,0.35)' };
export const heroSubtitle = { margin: 0, maxWidth: 760, fontSize: 18, lineHeight: 1.5, color: 'rgba(235,241,255,0.88)' };
export const heroSearchWrap = { width: 'min(100%, 980px)', display: 'grid', gap: 14, justifyItems: 'center' };
export const heroTabs = { display: 'inline-flex', gap: 8, padding: 6, borderRadius: 999, background: 'rgba(12,18,39,0.72)', border: '1px solid rgba(94,128,202,0.34)' };
export const tabButton = { border: 0, borderRadius: 999, background: 'transparent', color: 'rgba(255,255,255,0.85)', padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
export const activeTab = { ...tabButton, background: '#ffffff', color: '#1457d6', boxShadow: '0 6px 16px rgba(0,0,0,0.18)' };
export const searchBar = { width: 'min(100%, 980px)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) 1px minmax(220px, 0.95fr) auto', alignItems: 'stretch', borderRadius: 18, overflow: 'hidden', background: '#fff', boxShadow: '0 18px 40px rgba(4, 10, 28, 0.24)' };
export const searchFieldWrap = { display: 'grid' };
export const divider = { width: 1, background: '#e1e7f2' };
export const searchInput = { width: '100%', border: 0, padding: '22px 20px', fontSize: 18, outline: 'none', color: '#0f172a' };
export const searchSelect = { width: '100%', border: 0, padding: '22px 18px', fontSize: 18, outline: 'none', color: '#334155', background: 'transparent' };
export const searchBtn = { border: '1px solid #2a3c78', background: '#2e7dff', color: '#fff', padding: '0 34px', fontSize: 18, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 20px rgba(46,125,255,0.28)' };
export const statsRow = { width: 'min(100%, 980px)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 };
export const statCard = { borderRadius: 18, padding: '14px 16px', background: 'rgba(12,18,39,0.66)', border: '1px solid rgba(94,128,202,0.28)', textAlign: 'left' };
export const statLabel = { display: 'block', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(159,192,255,0.92)' };
export const statValue = { display: 'block', marginTop: 8, fontSize: 24, color: '#fff' };
export const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };

const postShell = { color: '#fff', padding: 0 };
const postTopRow = { display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr) auto', gap: 14, alignItems: 'center', marginBottom: 10 };
const postActions = { display: 'flex', alignItems: 'center', gap: 10, position: 'relative' };
const avatar = { width: 42, height: 42, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #ffd6e8, #c7d6ff)', color: '#0f172a', fontWeight: 800, fontSize: 18 };
const postTitle = { fontSize: 18, lineHeight: 1.15, fontWeight: 800, color: '#fff', marginBottom: 2 };
const postMeta = { display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.82)', alignItems: 'center' };
const postBusiness = { fontWeight: 700, color: '#fff' };
const postLocation = { marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.72)' };
const openPill = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 88, height: 48, padding: '0 18px', borderRadius: 999, border: '1px solid #d7dbe5', background: '#fff', color: '#111827', textDecoration: 'none', fontWeight: 800, fontSize: 18, alignSelf: 'center' };
const bookmarkBtn = (active) => ({
  width: 48,
  height: 48,
  borderRadius: 999,
  border: '1px solid rgba(215,219,229,0.9)',
  background: active ? 'rgba(46,125,255,0.18)' : '#fff',
  color: active ? '#2e7dff' : '#111827',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
});
const bookmarkIcon = (active) => ({ display: 'block', fontSize: 20, transform: active ? 'scale(1.02)' : 'scale(1)' });
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
const heroMediaAsset = { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#050a1a' };
const mediaCaption = { position: 'absolute', left: 0, right: 0, bottom: 22, padding: '16px 16px 14px', fontSize: 14, lineHeight: 1.4, color: '#fff', background: 'linear-gradient(180deg, rgba(15,23,42,0) 0%, rgba(15,23,42,0.72) 100%)', textShadow: '0 1px 2px rgba(0,0,0,0.35)', whiteSpace: 'pre-wrap', pointerEvents: 'none' };
const carouselArrowBase = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: 999, border: 0, background: 'rgba(255,255,255,0.88)', color: '#111827', fontSize: 24, lineHeight: '30px', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.18)' };
const carouselArrowLeft = { ...carouselArrowBase, left: 10 };
const carouselArrowRight = { ...carouselArrowBase, right: 10 };
const carouselDots = { position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 999, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)' };
const dot = { width: 7, height: 7, borderRadius: 999, border: 0, background: 'rgba(255,255,255,0.45)', padding: 0, cursor: 'pointer' };
const activeDot = { ...dot, background: '#fff', width: 8, height: 8 };
const videoProgress = { position: 'absolute', left: 14, right: 14, bottom: 38, width: 'calc(100% - 28px)', accentColor: '#2e7dff' };
const emptyState = { marginTop: 12, padding: 18, borderRadius: 16, border: '1px solid rgba(94,128,202,0.28)', background: 'rgba(12,18,39,0.66)', display: 'grid', gap: 14, color: '#fff' };
const emptyTitle = { margin: 0, fontSize: 18 };
const emptyCopy = { margin: '6px 0 0', color: 'rgba(255,255,255,0.82)', lineHeight: 1.5 };
const emptyActions = { display: 'flex', gap: 10, flexWrap: 'wrap' };
const primaryAction = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '10px 14px', borderRadius: 10, background: '#2e7dff', color: '#fff', textDecoration: 'none', fontWeight: 700 };
const secondaryAction = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '10px 14px', borderRadius: 10, background: '#0e1738', color: '#fff', textDecoration: 'none', fontWeight: 700, border: '1px solid #304178' };
