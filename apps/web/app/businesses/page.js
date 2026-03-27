'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { US_STATES } from '../../lib/us-states';

function yearsSince(startDate) {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  const m = now.getMonth() - start.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < start.getDate())) years -= 1;
  return Math.max(0, years);
}

function completeness(details) {
  const fields = [
    !!details.description,
    !!details.category,
    !!details.start_date,
    details.annual_revenue !== '' && details.annual_revenue !== null,
    details.annual_profit !== '' && details.annual_profit !== null,
    details.default_asking_price !== '' && details.default_asking_price !== null,
    !!details.city,
    !!details.state,
    !!details.country,
    !!details.county,
    !!details.keywords,
  ];
  const done = fields.filter(Boolean).length;
  return Math.round((done / fields.length) * 100);
}

const countries = [
  'United States','Canada','United Kingdom','Australia','Germany','France','Spain','Italy','Netherlands','Sweden',
  'Norway','Denmark','Switzerland','India','Mexico','Brazil','United Arab Emirates','Singapore','Japan','South Africa'
];

const emptyDetails = {
  description: '',
  category: 'established',
  start_date: '',
  annual_revenue: '',
  annual_profit: '',
  default_asking_price: '',
  city: '',
  state: '',
  country: 'United States',
  county: '',
  keywords: '',
};

export default function MyBusinessesPage() {
  const [userId, setUserId] = useState('');
  const [rows, setRows] = useState([]);
  const [membersByBusiness, setMembersByBusiness] = useState({});
  const [profileOptions, setProfileOptions] = useState([]);
  const [detailsByBusiness, setDetailsByBusiness] = useState({});
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newBusinessRole, setNewBusinessRole] = useState('Owner');
  const [newBusinessState, setNewBusinessState] = useState('Florida');
  const [newBusinessCountry, setNewBusinessCountry] = useState('United States');
  const [inviteByBusiness, setInviteByBusiness] = useState({});
  const [focusBusinessId, setFocusBusinessId] = useState('');
  const [savedBusinessId, setSavedBusinessId] = useState('');
  const [msg, setMsg] = useState('');

  async function loadAll() {
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return setMsg('Please sign in to manage businesses.');
    setUserId(uid);

    const [{ data: memberships, error: membershipsErr }, { data: profiles }] = await Promise.all([
      supabase
        .from('business_memberships')
        .select('id,business_id,user_id,role,is_admin,status,businesses(id,name,status,created_by,description,category,start_date,annual_revenue,annual_profit,default_asking_price,city,state,country,county,keywords)')
        .eq('user_id', uid)
        .eq('status', 'approved'),
      supabase.from('profiles').select('id,full_name,handle').limit(500),
    ]);

    if (membershipsErr) {
      if (membershipsErr.message?.includes("public.business_memberships")) {
        setMsg('Business tables are not created yet in Supabase. Run latest supabase/schema.sql in SQL editor, then refresh.');
      } else {
        setMsg(membershipsErr.message);
      }
      return;
    }

    const businessRows = (memberships || []).map((m) => ({
      membershipId: m.id,
      business_id: m.business_id,
      role: m.role,
      is_admin: m.is_admin,
      business: m.businesses,
    }));

    setRows(businessRows);
    setProfileOptions(profiles || []);

    const details = {};
    businessRows.forEach((row) => {
      const b = row.business || {};
      details[row.business_id] = {
        description: b.description || '',
        category: b.category || 'established',
        start_date: b.start_date || '',
        annual_revenue: b.annual_revenue ?? '',
        annual_profit: b.annual_profit ?? '',
        default_asking_price: b.default_asking_price ?? '',
        city: b.city || '',
        state: b.state || '',
        country: b.country || 'United States',
        county: b.county || '',
        keywords: Array.isArray(b.keywords) ? b.keywords.join(', ') : '',
      };
    });
    setDetailsByBusiness(details);

    const ids = businessRows.map((r) => r.business_id);
    if (ids.length) {
      const { data: memberRows } = await supabase
        .from('business_memberships')
        .select('id,business_id,user_id,role,is_admin,status,profiles(id,full_name,handle)')
        .in('business_id', ids)
        .order('created_at', { ascending: true });

      const grouped = {};
      (memberRows || []).forEach((m) => {
        if (!grouped[m.business_id]) grouped[m.business_id] = [];
        grouped[m.business_id].push(m);
      });
      setMembersByBusiness(grouped);
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const target = new URLSearchParams(window.location.search).get('business') || '';
      setFocusBusinessId(target);
    }
    loadAll();
  }, []);

  useEffect(() => {
    if (!focusBusinessId) return;
    const el = document.getElementById(`business-card-${focusBusinessId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusBusinessId, rows.length]);

  async function createBusiness(e) {
    e.preventDefault();
    setMsg('');
    if (!supabase || !userId || !newBusinessName.trim()) return;

    const { data: created, error: createErr } = await supabase
      .from('businesses')
      .insert({
        name: newBusinessName.trim(),
        state: newBusinessState || null,
        country: newBusinessCountry || null,
        created_by: userId,
        status: 'approved',
      })
      .select('id')
      .single();

    if (createErr) return setMsg(createErr.message);

    const { error: membershipErr } = await supabase.from('business_memberships').upsert({
      business_id: created.id,
      user_id: userId,
      role: newBusinessRole || 'Owner',
      is_admin: true,
      status: 'approved',
    }, { onConflict: 'business_id,user_id' });

    if (membershipErr) return setMsg(membershipErr.message);

    setNewBusinessName('');
    setMsg('Business created. Fill out details below once, then post without retyping.');
    loadAll();
  }

  async function saveDetails(businessId) {
    const details = detailsByBusiness[businessId] || emptyDetails;
    const payload = {
      description: details.description || null,
      category: details.category || null,
      start_date: details.start_date || null,
      annual_revenue: details.annual_revenue ? Number(details.annual_revenue) : null,
      annual_profit: details.annual_profit ? Number(details.annual_profit) : null,
      default_asking_price: details.default_asking_price ? Number(details.default_asking_price) : null,
      city: details.city || null,
      state: details.state || null,
      country: details.country || null,
      county: details.county || null,
      keywords: (details.keywords || '').split(',').map((k) => k.trim()).filter(Boolean),
    };

    const { error } = await supabase.from('businesses').update(payload).eq('id', businessId);
    if (error) {
      setMsg(error.message);
      setSavedBusinessId('');
      return;
    }

    setSavedBusinessId(businessId);
    setMsg('Business saved.');
    setTimeout(() => {
      const el = document.getElementById(`members-${businessId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  async function inviteMember(businessId) {
    const invite = inviteByBusiness[businessId] || {};
    if (!supabase || !businessId || !invite.user_id) return;

    const { error } = await supabase.from('business_memberships').upsert({
      business_id: businessId,
      user_id: invite.user_id,
      role: invite.role || 'Authorized Representative',
      is_admin: !!invite.is_admin,
      status: 'approved',
    }, { onConflict: 'business_id,user_id' });

    if (error) return setMsg(error.message);
    setInviteByBusiness((prev) => ({ ...prev, [businessId]: { user_id: '', role: 'Authorized Representative', is_admin: false } }));
    setMsg('Member added.');
    loadAll();
  }

  async function setAdmin(memberId, makeAdmin) {
    const { error } = await supabase.from('business_memberships').update({ is_admin: makeAdmin }).eq('id', memberId);
    if (error) return setMsg(error.message);
    loadAll();
  }

  const businessCount = useMemo(() => rows.length, [rows]);

  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={{ marginTop: 0 }}>My Businesses</h1>
        <p style={{ opacity: 0.8 }}>Businesses you control ({businessCount}).</p>

        <form onSubmit={createBusiness} style={createWrap}>
          <input style={input} placeholder='Business name' value={newBusinessName} onChange={(e) => setNewBusinessName(e.target.value)} required />
          <select style={input} value={newBusinessRole} onChange={(e) => setNewBusinessRole(e.target.value)}>
            <option>Owner</option><option>CEO</option><option>Founder</option><option>Broker</option><option>Managing Partner</option><option>Authorized Representative</option>
          </select>
          <select style={input} value={newBusinessState} onChange={(e) => setNewBusinessState(e.target.value)}>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={input} value={newBusinessCountry} onChange={(e) => setNewBusinessCountry(e.target.value)}>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button style={btnPrimary} type='submit'>Create Business</button>
        </form>

        {msg ? <p>{msg}</p> : null}

        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((row) => {
            const members = membersByBusiness[row.business_id] || [];
            const canManage = row.is_admin;
            const invite = inviteByBusiness[row.business_id] || { user_id: '', role: 'Authorized Representative', is_admin: false };
            const details = detailsByBusiness[row.business_id] || emptyDetails;
            const age = yearsSince(details.start_date);
            const completePct = completeness(details);

            return (
              <section id={`business-card-${row.business_id}`} key={row.business_id} style={row.business_id === focusBusinessId ? { ...bizCard, border: '1px solid #8fb7ff', boxShadow: '0 0 0 2px rgba(143,183,255,0.25)' } : bizCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{row.business?.name || 'Business'}</strong>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>Your role: {row.role}{row.is_admin ? ' · Admin' : ''}</div>
                    <div style={{ opacity: 0.72, fontSize: 12 }}>{age !== null ? `Calculated age: ${age} year${age === 1 ? '' : 's'}` : 'Set start date to auto-calculate age'}</div>
                    <div style={{ opacity: 0.72, fontSize: 12 }}>Profile completeness: {completePct}%</div>
                  </div>
                  <a href={`/listings/new?business=${row.business_id}`} style={btn}>Post as this business</a>
                </div>

                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                  <textarea style={{ ...input, gridColumn: '1 / -1' }} rows={3} placeholder='Business description' value={details.description} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, description: e.target.value } }))} />
                  <select style={input} value={details.category} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, category: e.target.value } }))}>
                    <option value='established'>Established Businesses</option>
                    <option value='asset_sale'>Asset Sales</option>
                    <option value='real_estate'>Real Estate</option>
                    <option value='startup'>Start-up Businesses</option>
                  </select>
                  <input style={input} type='date' value={details.start_date} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, start_date: e.target.value } }))} />
                  <input style={input} placeholder='Annual revenue' value={details.annual_revenue} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, annual_revenue: e.target.value } }))} />
                  <input style={input} placeholder='Annual profit' value={details.annual_profit} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, annual_profit: e.target.value } }))} />
                  <input style={input} placeholder='Default asking price' value={details.default_asking_price} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, default_asking_price: e.target.value } }))} />
                  <input style={input} placeholder='City' value={details.city} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, city: e.target.value } }))} />
                  <select style={input} value={details.state} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, state: e.target.value } }))}>
                    <option value=''>State</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select style={input} value={details.country} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, country: e.target.value } }))}>
                    <option value=''>Country</option>
                    {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input style={input} placeholder='County' value={details.county} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, county: e.target.value } }))} />
                  <input style={{ ...input, gridColumn: '1 / -1' }} placeholder='Keywords (comma separated)' value={details.keywords} onChange={(e) => setDetailsByBusiness((prev) => ({ ...prev, [row.business_id]: { ...details, keywords: e.target.value } }))} />
                  <button style={btnPrimary} type='button' onClick={() => saveDetails(row.business_id)}>Save Business Details</button>
                </div>

                {savedBusinessId === row.business_id ? (
                  <div style={savedBanner}>
                    <strong>✅ Business saved</strong>
                    <span style={{ opacity: 0.9 }}>Now manage people/members below.</span>
                    <button type='button' style={savedManageBtn} onClick={() => document.getElementById(`members-${row.business_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Manage Members</button>
                  </div>
                ) : null}

                <div id={`members-${row.business_id}`} style={{ marginTop: 8 }}>
                  <strong style={{ fontSize: 13 }}>People</strong>
                  <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    {members.map((m) => (
                      <div key={m.id} style={memberRow}>
                        <div>
                          <div>{m.profiles?.full_name || m.profiles?.handle || m.user_id}</div>
                          <small style={{ opacity: 0.75 }}>{m.role} {m.is_admin ? '· Admin' : ''}</small>
                        </div>
                        {canManage ? (
                          <button style={btn} onClick={() => setAdmin(m.id, !m.is_admin)} type='button'>
                            {m.is_admin ? 'Remove admin' : 'Make admin'}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                {canManage ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto auto', gap: 8, marginTop: 10 }}>
                    <select style={input} value={invite.user_id} onChange={(e) => setInviteByBusiness((prev) => ({ ...prev, [row.business_id]: { ...invite, user_id: e.target.value } }))}>
                      <option value=''>Select user</option>
                      {profileOptions.filter((p) => p.id !== userId).map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || p.handle || p.id}</option>
                      ))}
                    </select>
                    <select style={input} value={invite.role} onChange={(e) => setInviteByBusiness((prev) => ({ ...prev, [row.business_id]: { ...invite, role: e.target.value } }))}>
                      <option>Owner</option><option>CEO</option><option>Founder</option><option>Broker</option><option>Managing Partner</option><option>Authorized Representative</option>
                    </select>
                    <label style={label}><input type='checkbox' checked={invite.is_admin} onChange={(e) => setInviteByBusiness((prev) => ({ ...prev, [row.business_id]: { ...invite, is_admin: e.target.checked } }))} /> Admin</label>
                    <button style={btnPrimary} type='button' onClick={() => inviteMember(row.business_id)}>Add</button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 980, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16, display: 'grid', gap: 12 };
const createWrap = { display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr auto', gap: 8 };
const bizCard = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', padding: 12 };
const memberRow = { border: '1px solid #304178', borderRadius: 8, padding: 8, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '8px 10px', textDecoration: 'none', cursor: 'pointer' };
const btnPrimary = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const label = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 };
const savedBanner = { marginTop: 10, border: '1px solid #2f8f5b', borderRadius: 10, background: '#123825', color: '#d8ffe9', padding: '10px 12px', display: 'grid', gap: 6 };
const savedManageBtn = { width: 'fit-content', border: '1px solid #57b987', borderRadius: 999, background: '#16472f', color: '#e9fff3', padding: '6px 10px', cursor: 'pointer', fontWeight: 600 };
