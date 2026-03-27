'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function MyBusinessesPage() {
  const [userId, setUserId] = useState('');
  const [rows, setRows] = useState([]);
  const [membersByBusiness, setMembersByBusiness] = useState({});
  const [profileOptions, setProfileOptions] = useState([]);
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newBusinessRole, setNewBusinessRole] = useState('Owner');
  const [inviteByBusiness, setInviteByBusiness] = useState({});
  const [msg, setMsg] = useState('');

  async function loadAll() {
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setMsg('Please sign in to manage businesses.');
      return;
    }
    setUserId(uid);

    const [{ data: memberships, error: membershipsErr }, { data: profiles }] = await Promise.all([
      supabase
        .from('business_memberships')
        .select('id,business_id,user_id,role,is_admin,status,businesses(id,name,status,created_by)')
        .eq('user_id', uid)
        .eq('status', 'approved'),
      supabase.from('profiles').select('id,full_name,handle').limit(500),
    ]);

    if (membershipsErr) {
      setMsg(membershipsErr.message);
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
    loadAll();
  }, []);

  async function createBusiness(e) {
    e.preventDefault();
    setMsg('');
    if (!supabase || !userId) return;
    if (!newBusinessName.trim()) return setMsg('Business name is required.');

    const { data: created, error: createErr } = await supabase
      .from('businesses')
      .insert({ name: newBusinessName.trim(), created_by: userId, status: 'approved' })
      .select('id')
      .single();

    if (createErr) return setMsg(createErr.message);

    const { error: membershipErr } = await supabase.from('business_memberships').insert({
      business_id: created.id,
      user_id: userId,
      role: newBusinessRole,
      is_admin: true,
      status: 'approved',
    });

    if (membershipErr) return setMsg(membershipErr.message);

    setNewBusinessName('');
    setNewBusinessRole('Owner');
    setMsg('Business created and approved.');
    loadAll();
  }

  async function inviteMember(businessId) {
    setMsg('');
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
    if (!supabase) return;
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
          <button style={btnPrimary} type='submit'>Create Business</button>
        </form>

        {msg ? <p>{msg}</p> : null}

        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((row) => {
            const members = membersByBusiness[row.business_id] || [];
            const canManage = row.is_admin;
            const invite = inviteByBusiness[row.business_id] || { user_id: '', role: 'Authorized Representative', is_admin: false };

            return (
              <section key={row.business_id} style={bizCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{row.business?.name || 'Business'}</strong>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>Your role: {row.role}{row.is_admin ? ' · Admin' : ''}</div>
                  </div>
                  <a href={`/listings/new?business=${row.business_id}`} style={btn}>Post as this business</a>
                </div>

                <div style={{ marginTop: 8 }}>
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
                    {members.length === 0 ? <small style={{ opacity: 0.7 }}>No members yet.</small> : null}
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
const createWrap = { display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 8 };
const bizCard = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', padding: 12 };
const memberRow = { border: '1px solid #304178', borderRadius: 8, padding: 8, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '8px 10px', textDecoration: 'none', cursor: 'pointer' };
const btnPrimary = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const label = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 };
