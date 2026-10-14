(function () {
    'use strict';

    const $app = document.getElementById('app');
    const $toasts = document.getElementById('toasts');

    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ));

    const fmtDate = value => (value ? new Date(value).toLocaleString() : '');
    const badge = (value, extra = '') => `<span class="badge ${esc(value)} ${esc(extra)}">${esc(value)}</span>`;

    function toQuery(params) {
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.set(key, value);
            }
        });
        return query.toString();
    }

    const storage = {
        get(key) { try { return sessionStorage.getItem(key); } catch (error) { return null; } },
        set(key, value) { try { sessionStorage.setItem(key, value); } catch (error) { } },
        remove(key) { try { sessionStorage.removeItem(key); } catch (error) { } }
    };

    function toast(message, type = 'info') {
        const node = document.createElement('div');
        node.className = `toast ${type}`;
        node.textContent = message;
        $toasts.appendChild(node);
        setTimeout(() => node.remove(), type === 'error' ? 6000 : 3000);
    }

    const state = { token: storage.get('usof_token'), me: null, communities: [], open_reports: null };

    async function api(method, path, { query, body } = {}) {
        const qs = query ? toQuery(query) : '';
        const response = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, {
            method,
            headers: {
                ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        });

        let data = null;
        try { data = await response.json(); } catch (error) { }

        if (!response.ok) {
            if (response.status === 401 && state.token) {
                logout();
            }
            throw new Error((data && data.message) || `Request failed (${response.status})`);
        }
        return data;
    }

    const isAdmin = () => state.me && state.me.role === 'ADMIN';
    const isSiteStaff = () => state.me && (state.me.role === 'ADMIN' || state.me.role === 'MODERATOR');

    function logout() {
        storage.remove('usof_token');
        state.token = null;
        state.me = null;
        renderLogin();
    }

    function openModal({ title, html, submit = 'Save', danger = false, onSubmit }) {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.innerHTML = `
            <form class="modal">
                <h2>${esc(title)}</h2>
                ${html}
                <div class="modal-actions">
                    <button type="button" class="btn" data-close>${onSubmit ? 'Cancel' : 'Close'}</button>
                    ${onSubmit ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submit)}</button>` : ''}
                </div>
            </form>`;
        document.body.appendChild(overlay);

        const form = overlay.querySelector('form');
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = event => { if (event.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.querySelector('[data-close]').addEventListener('click', close);

        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (!onSubmit) { return close(); }
            const button = form.querySelector('button[type=submit]');
            button.disabled = true;
            try {
                await onSubmit(Object.fromEntries(new FormData(form).entries()));
                close();
            } catch (error) {
                toast(error.message, 'error');
                button.disabled = false;
            }
        });
        return form;
    }

    const lists = {};

    function listView(spec) {
        const view = lists[spec.key] || (lists[spec.key] = { page: 1, values: { ...(spec.defaults || {}) } });

        return async function render(container) {
            const filterHtml = (spec.filters || []).map(filter => {
                const value = view.values[filter.name] ?? '';
                if (filter.type === 'select') {
                    return `<div><label>${esc(filter.label)}</label><select data-filter="${esc(filter.name)}">
                        ${filter.options.map(([optionValue, label]) => `<option value="${esc(optionValue)}" ${String(value) === String(optionValue) ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                    </select></div>`;
                }
                return `<div><label>${esc(filter.label)}</label><input data-filter="${esc(filter.name)}" value="${esc(value)}" placeholder="${esc(filter.placeholder || '')}"></div>`;
            }).join('');

            container.innerHTML = `
                <div class="filters">${filterHtml}</div>
                <div id="list-body"><div class="empty">Loading...</div></div>`;

            container.querySelectorAll('[data-filter]').forEach(input => {
                const apply = () => {
                    view.values[input.dataset.filter] = input.value;
                    view.page = 1;
                    load();
                };
                input.addEventListener('change', apply);
            });

            const body = container.querySelector('#list-body');

            async function load() {
                try {
                    const result = await api('GET', spec.endpoint, { query: { ...view.values, page: view.page, limit: 15 } });
                    const rows = result.data;
                    const meta = result.meta;

                    if (rows.length === 0) {
                        body.innerHTML = '<div class="table-wrap"><div class="empty">Nothing here.</div></div>';
                        return;
                    }

                    body.innerHTML = `
                        <div class="table-wrap"><table>
                            <thead><tr>${spec.columns.map(column => `<th>${esc(column.label)}</th>`).join('')}${spec.actions ? '<th></th>' : ''}</tr></thead>
                            <tbody>${rows.map((row, index) => `<tr>
                                ${spec.columns.map(column => `<td>${column.render(row)}</td>`).join('')}
                                ${spec.actions ? `<td><div class="row-actions" data-row="${index}">${spec.actions(row)}</div></td>` : ''}
                            </tr>`).join('')}</tbody>
                        </table></div>
                        <div class="pager">
                            <span>${meta.total} total, page ${meta.page} of ${Math.max(meta.totalPages, 1)}</span>
                            <span class="row-actions">
                                <button class="btn small" data-page="prev" ${meta.page <= 1 ? 'disabled' : ''}>Previous</button>
                                <button class="btn small" data-page="next" ${meta.page >= meta.totalPages ? 'disabled' : ''}>Next</button>
                            </span>
                        </div>`;

                    body.querySelectorAll('[data-page]').forEach(button => {
                        button.addEventListener('click', () => {
                            view.page += button.dataset.page === 'next' ? 1 : -1;
                            load();
                        });
                    });
                    body.querySelectorAll('[data-act]').forEach(button => {
                        button.addEventListener('click', () => {
                            const row = rows[Number(button.closest('[data-row]').dataset.row)];
                            spec.onAction(button.dataset.act, row, load);
                        });
                    });
                } catch (error) {
                    body.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
                }
            }

            await load();
        };
    }

    function pageShell({ title, subtitle = '', actions = '', body }) {
        return `
            <div class="page-head">
                <div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
                <div class="row-actions">${actions}</div>
            </div>
            ${body}`;
    }

    const REASONS = ['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'MISINFORMATION', 'INAPPROPRIATE', 'OTHER'];
    const withAll = (label, values) => [['', label], ...values.map(value => [value, value])];

    function reportTarget(report) {
        if (report.target_type === 'POST') {
            return report.post
                ? `<b>${esc(report.post.title)}</b> ${badge(report.post.status)}`
                : `${esc(report.target_excerpt)} <i>(deleted)</i>`;
        }
        if (report.target_type === 'COMMENT') {
            return report.comment
                ? `<div class="excerpt">${esc(report.comment.content.slice(0, 160))}</div> ${badge(report.comment.status)}`
                : `<div class="excerpt">${esc(report.target_excerpt)} <i>(deleted)</i></div>`;
        }
        return report.target_user ? `<b>${esc(report.target_user.login)}</b>${report.target_user.is_suspended ? ' ' + badge('suspended') : ''}` : esc(report.target_excerpt);
    }

    function reportColumns(showCommunity) {
        return [
            { label: '#', render: report => report.id },
            { label: 'Type', render: report => badge(report.target_type) },
            { label: 'Reason', render: report => esc(report.reason.replace('_', ' ')) },
            { label: 'Target', render: reportTarget },
            ...(showCommunity ? [{ label: 'Community', render: report => esc(report.community ? report.community.title : 'site level') }] : []),
            { label: 'Reporter', render: report => esc(report.reporter.login) },
            { label: 'Open on target', render: report => report.status === 'OPEN' ? report.open_reports_on_target : '' },
            { label: 'Created', render: report => fmtDate(report.created_at) },
            { label: 'Status', render: report => badge(report.status) }
        ];
    }

    function reviewReport(report, scope, refresh) {
        const base = scope ? `/communities/${scope.community_id}/moderation` : '/admin';
        const is_content = report.target_type !== 'USER';
        const has_content = is_content && (report.post || report.comment);

        const actions = [['NONE', 'Mark as resolved, no action']];
        if (has_content) { actions.push(['HIDE_CONTENT', 'Hide the content']); }
        if (has_content && (scope || isAdmin())) { actions.push(['DELETE_CONTENT', 'Delete the content']); }
        if (report.community && (scope || isAdmin())) { actions.push(['BAN_USER', 'Ban the user from the community']); }
        if (!scope && isAdmin()) { actions.push(['SUSPEND_USER', 'Suspend the account (site wide)']); }

        const details = `
            <dl class="kv">
                <dt>Type</dt><dd>${badge(report.target_type)} ${esc(report.reason.replace('_', ' '))}</dd>
                <dt>Target</dt><dd>${reportTarget(report)}</dd>
                <dt>Reporter</dt><dd>${esc(report.reporter.login)}</dd>
                <dt>Details</dt><dd>${esc(report.details || 'none')}</dd>
                <dt>Open on target</dt><dd>${report.open_reports_on_target}</dd>
                <dt>Status</dt><dd>${badge(report.status)} ${esc(report.resolution_note || '')}</dd>
            </dl>`;

        if (report.status !== 'OPEN') {
            openModal({ title: `Report #${report.id}`, html: details });
            return;
        }

        const form = openModal({
            title: `Report #${report.id}`,
            submit: 'Resolve',
            html: `${details}
                <label>Action</label>
                <select name="action">${actions.map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}</select>
                <div id="ban-days" hidden><label>Ban length in days (empty = permanent)</label><input name="ban_days" type="number" min="1"></div>
                <label>Note</label><textarea name="note" maxlength="1000" placeholder="Visible to the other moderators"></textarea>`,
            onSubmit: async values => {
                await api('POST', `${base}/reports/${report.id}/resolve`, {
                    body: { action: values.action, note: values.note || undefined, ban_days: values.ban_days || undefined }
                });
                toast('Report resolved');
                refresh();
            }
        });
        form.querySelector('[name=action]').addEventListener('change', event => {
            form.querySelector('#ban-days').hidden = event.target.value !== 'BAN_USER';
        });
    }

    function dismissReport(report, scope, refresh) {
        const base = scope ? `/communities/${scope.community_id}/moderation` : '/admin';
        openModal({
            title: `Dismiss report #${report.id}`,
            submit: 'Dismiss',
            html: '<p>The content stays as it is.</p><label>Note</label><textarea name="note" maxlength="1000"></textarea>',
            onSubmit: async values => {
                await api('POST', `${base}/reports/${report.id}/dismiss`, { body: { note: values.note || undefined } });
                toast('Report dismissed');
                refresh();
            }
        });
    }

    function reportsView(key, scope) {
        const endpoint = scope ? `/communities/${scope.community_id}/moderation/reports` : '/admin/reports';
        return listView({
            key,
            endpoint,
            defaults: { status: 'OPEN', sort: 'date', order: 'desc' },
            filters: [
                { name: 'status', label: 'Status', type: 'select', options: [['OPEN', 'Open'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed'], ['ALL', 'All']] },
                { name: 'target_type', label: 'Type', type: 'select', options: withAll('Any', ['POST', 'COMMENT', 'USER']) },
                { name: 'reason', label: 'Reason', type: 'select', options: withAll('Any', REASONS) },
                { name: 'sort', label: 'Sort by', type: 'select', options: [['date', 'Date'], ['reason', 'Reason'], ['status', 'Status']] },
                { name: 'order', label: 'Order', type: 'select', options: [['desc', 'Descending'], ['asc', 'Ascending']] }
            ],
            columns: reportColumns(!scope),
            actions: report => `<button class="btn small primary" data-act="review">${report.status === 'OPEN' ? 'Review' : 'View'}</button>
                ${report.status === 'OPEN' ? '<button class="btn small" data-act="dismiss">Dismiss</button>' : ''}`,
            onAction: (action, report, refresh) => (action === 'review' ? reviewReport(report, scope, refresh) : dismissReport(report, scope, refresh))
        });
    }

    function requestsView(key, scope) {
        const endpoint = scope ? `/communities/${scope.community_id}/moderation/category-requests` : '/admin/category-requests';
        const base = scope ? `/communities/${scope.community_id}/moderation/category-requests` : '/admin/category-requests';

        return listView({
            key,
            endpoint,
            defaults: { status: 'PENDING', sort: 'date', order: 'desc' },
            filters: [
                { name: 'status', label: 'Status', type: 'select', options: [['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All']] },
                ...(scope ? [] : [{ name: 'kind', label: 'Kind', type: 'select', options: withAll('Any', ['GLOBAL', 'LOCAL']) }]),
                { name: 'sort', label: 'Sort by', type: 'select', options: [['date', 'Date'], ['title', 'Title'], ['status', 'Status']] },
                { name: 'order', label: 'Order', type: 'select', options: [['desc', 'Descending'], ['asc', 'Ascending']] }
            ],
            columns: [
                { label: 'Title', render: request => `<b>${esc(request.title)}</b><div class="excerpt">${esc(request.description || '')}</div>` },
                { label: 'Kind', render: request => badge(request.kind) },
                { label: 'Community', render: request => esc(request.community ? request.community.title : '') },
                { label: 'Requested by', render: request => esc(request.requester.login) },
                { label: 'Created', render: request => fmtDate(request.created_at) },
                { label: 'Status', render: request => `${badge(request.status)} ${esc(request.review_note || '')}` }
            ],
            actions: request => (request.status === 'PENDING'
                ? '<button class="btn small primary" data-act="approve">Approve</button><button class="btn small" data-act="reject">Reject</button>'
                : ''),
            onAction: (action, request, refresh) => openModal({
                title: `${action === 'approve' ? 'Approve' : 'Reject'} "${request.title}"`,
                submit: action === 'approve' ? 'Approve' : 'Reject',
                danger: action === 'reject',
                html: `<p>${action === 'approve'
                    ? (request.kind === 'GLOBAL' ? 'The global category will be created and attached to the community.' : 'The category will be created in the community.')
                    : 'The requester will see your note.'}</p>
                    <label>Note</label><textarea name="note" maxlength="1000"></textarea>`,
                onSubmit: async values => {
                    await api('POST', `${base}/${request.id}/${action}`, { body: { note: values.note || undefined } });
                    toast(action === 'approve' ? 'Category created' : 'Request rejected');
                    refresh();
                }
            })
        });
    }

    function logView(key, scope) {
        return listView({
            key,
            endpoint: scope ? `/communities/${scope.community_id}/moderation/log` : '/admin/moderation-log',
            defaults: { sort: 'date', order: 'desc' },
            filters: [
                { name: 'action', label: 'Action', type: 'text', placeholder: 'e.g. post.hidden' },
                { name: 'order', label: 'Order', type: 'select', options: [['desc', 'Newest first'], ['asc', 'Oldest first']] }
            ],
            columns: [
                { label: 'When', render: entry => fmtDate(entry.created_at) },
                { label: 'Who', render: entry => esc(entry.actor ? entry.actor.login : 'deleted user') },
                { label: 'Action', render: entry => `<code>${esc(entry.action)}</code>` },
                ...(scope ? [] : [{ label: 'Community', render: entry => esc(entry.community ? entry.community.title : 'site') }]),
                { label: 'Target', render: entry => esc(entry.target_type ? `${entry.target_type} #${entry.target_id}` : '') },
                { label: 'Note', render: entry => `<div class="excerpt">${esc(entry.note || '')}</div>` }
            ]
        });
    }

    function statCard(label, value, kind = '') {
        return `<div class="stat ${kind}"><div class="num">${esc(value)}</div><div class="label">${esc(label)}</div></div>`;
    }

    function recentActionsTable(actions) {
        if (!actions.length) { return '<div class="empty">No actions yet.</div>'; }
        return `<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Note</th></tr></thead><tbody>
            ${actions.map(entry => `<tr><td>${fmtDate(entry.created_at)}</td><td>${esc(entry.actor ? entry.actor.login : '')}</td>
            <td><code>${esc(entry.action)}</code></td><td><div class="excerpt">${esc(entry.note || '')}</div></td></tr>`).join('')}
        </tbody></table></div>`;
    }

    async function siteDashboard(main) {
        const overview = await api('GET', '/admin/overview');
        const counts = overview.counts;
        state.open_reports = counts.open_reports;

        main.innerHTML = pageShell({
            title: 'Dashboard',
            subtitle: isAdmin() ? 'Everything on the site' : 'Site moderation: reports, content and activity',
            body: `
                <div class="stats">
                    ${statCard('Open reports', counts.open_reports, counts.open_reports ? 'alert' : '')}
                    ${statCard('Pending local categories', counts.pending_local_category_requests, counts.pending_local_category_requests ? 'warn' : '')}
                    ${counts.pending_global_category_requests === null ? '' : statCard('Pending global categories', counts.pending_global_category_requests, counts.pending_global_category_requests ? 'warn' : '')}
                    ${statCard('Users', counts.users)}
                    ${statCard('Suspended users', counts.suspended_users)}
                    ${statCard('Communities', counts.communities)}
                    ${statCard('Active posts', counts.posts.ACTIVE)}
                    ${statCard('Hidden posts', counts.posts.INACTIVE)}
                    ${statCard('Hidden comments', counts.hidden_comments)}
                    ${statCard('Active bans', counts.active_bans)}
                    ${statCard('New users, 7 days', overview.last_7_days.new_users)}
                    ${statCard('New posts, 7 days', overview.last_7_days.new_posts)}
                </div>
                <div class="card"><h2>Biggest communities</h2>
                    ${overview.top_communities.length ? `<div class="table-wrap"><table><thead><tr><th>Community</th><th>Members</th><th>Posts</th></tr></thead><tbody>
                        ${overview.top_communities.map(item => `<tr><td>${esc(item.title)}</td><td>${item.members}</td><td>${item.posts}</td></tr>`).join('')}
                    </tbody></table></div>` : '<div class="empty">No communities yet.</div>'}
                </div>
                <div class="card"><h2>Recent moderation actions</h2>${recentActionsTable(overview.recent_actions)}</div>`
        });
        renderNav();
    }

    function usersView() {
        return listView({
            key: 'site-users',
            endpoint: '/admin/users',
            defaults: { sort: 'rating', order: 'desc' },
            filters: [
                { name: 'search', label: 'Search', type: 'text', placeholder: isAdmin() ? 'login, name or email' : 'login or name' },
                { name: 'role', label: 'Role', type: 'select', options: withAll('Any', ['USER', 'MODERATOR', 'ADMIN']) },
                { name: 'suspended', label: 'Suspended', type: 'select', options: [['', 'Any'], ['true', 'Yes'], ['false', 'No']] },
                { name: 'sort', label: 'Sort by', type: 'select', options: [['rating', 'Rating'], ['date', 'Joined'], ['login', 'Login'], ['name', 'Name'], ['posts', 'Posts']] },
                { name: 'order', label: 'Order', type: 'select', options: [['desc', 'Descending'], ['asc', 'Ascending']] }
            ],
            columns: [
                { label: 'Login', render: user => `<b>${esc(user.login)}</b><div>${esc(user.full_name)}</div>` },
                ...(isAdmin() ? [{ label: 'Email', render: user => esc(user.email) }] : []),
                { label: 'Role', render: user => badge(user.role) },
                { label: 'Rating', render: user => user.rating },
                { label: 'Posts / comments', render: user => `${user._count.posts} / ${user._count.comments}` },
                { label: 'Reports against', render: user => user._count.reports_against },
                { label: 'Joined', render: user => fmtDate(user.created_at) },
                { label: 'State', render: user => (user.is_suspended ? `${badge('suspended')} ${esc(user.suspended_reason || '')}` : '') }
            ],
            actions: user => (!isAdmin() || user.id === state.me.id ? '' : `
                ${user.is_suspended
        ? '<button class="btn small" data-act="unsuspend">Restore</button>'
        : (user.role === 'ADMIN' ? '' : '<button class="btn small danger" data-act="suspend">Suspend</button>')}
                <button class="btn small" data-act="role">Role</button>`),
            onAction: (action, user, refresh) => {
                if (action === 'suspend') {
                    openModal({
                        title: `Suspend ${user.login}`, submit: 'Suspend', danger: true,
                        html: '<p>The user is signed out and cannot log in until restored.</p><label>Reason</label><textarea name="reason" maxlength="500"></textarea>',
                        onSubmit: async values => {
                            await api('POST', `/admin/users/${user.id}/suspend`, { body: { reason: values.reason || undefined } });
                            toast('Account suspended');
                            refresh();
                        }
                    });
                } else if (action === 'unsuspend') {
                    api('POST', `/admin/users/${user.id}/unsuspend`).then(() => { toast('Account restored'); refresh(); }).catch(error => toast(error.message, 'error'));
                } else {
                    openModal({
                        title: `Role of ${user.login}`, submit: 'Save',
                        html: `<label>Role</label><select name="role">${['USER', 'MODERATOR', 'ADMIN'].map(role => `<option ${role === user.role ? 'selected' : ''}>${role}</option>`).join('')}</select>
                            <p>A moderator can handle reports and hide content, but cannot delete content or manage users.</p>`,
                        onSubmit: async values => {
                            await api('PATCH', `/users/${user.id}`, { body: { role: values.role } });
                            toast('Role updated');
                            refresh();
                        }
                    });
                }
            }
        });
    }

    async function communityOverview(main, community_id, title) {
        const overview = await api('GET', `/communities/${community_id}/moderation/overview`);
        const counts = overview.counts;

        main.innerHTML = pageShell({
            title,
            subtitle: 'Moderation panel of the community',
            body: `
                <div class="stats">
                    ${statCard('Open reports', counts.open_reports, counts.open_reports ? 'alert' : '')}
                    ${statCard('Category requests', counts.pending_category_requests, counts.pending_category_requests ? 'warn' : '')}
                    ${statCard('Active bans', counts.active_bans)}
                    ${statCard('Members', counts.members)}
                    ${statCard('Active posts', counts.posts.ACTIVE)}
                    ${statCard('Hidden posts', counts.posts.INACTIVE)}
                    ${statCard('Hidden comments', counts.hidden_comments)}
                </div>
                <div class="card"><h2>Recent activity</h2>${recentActionsTable(overview.recent_actions)}</div>`
        });
    }

    function bansView(community_id) {
        return listView({
            key: `c${community_id}-bans`,
            endpoint: `/communities/${community_id}/moderation/bans`,
            defaults: { sort: 'date', order: 'desc' },
            filters: [
                { name: 'sort', label: 'Sort by', type: 'select', options: [['date', 'Date'], ['login', 'Login'], ['expires', 'Expires']] },
                { name: 'order', label: 'Order', type: 'select', options: [['desc', 'Descending'], ['asc', 'Ascending']] },
                { name: 'include_expired', label: 'Expired bans', type: 'select', options: [['', 'Hide'], ['true', 'Show']] }
            ],
            columns: [
                { label: 'User', render: ban => `<b>${esc(ban.user.login)}</b><div>${esc(ban.user.full_name)}</div>` },
                { label: 'Reason', render: ban => `<div class="excerpt">${esc(ban.reason || '')}</div>` },
                { label: 'Banned by', render: ban => esc(ban.banned_by ? ban.banned_by.login : '') },
                { label: 'Since', render: ban => fmtDate(ban.created_at) },
                { label: 'Expires', render: ban => (ban.expires_at ? fmtDate(ban.expires_at) : 'never') }
            ],
            actions: () => '<button class="btn small" data-act="unban">Unban</button>',
            onAction: (action, ban, refresh) => {
                api('DELETE', `/communities/${community_id}/moderation/bans/${ban.user_id}`)
                    .then(() => { toast('User unbanned'); refresh(); })
                    .catch(error => toast(error.message, 'error'));
            }
        });
    }

    function openBanForm(community_id, after) {
        openModal({
            title: 'Ban a user from the community', submit: 'Ban', danger: true,
            html: `<label>User ID</label><input name="user_id" type="number" min="1" required>
                <label>Length in days (empty = permanent)</label><input name="duration_days" type="number" min="1">
                <label>Reason</label><textarea name="reason" maxlength="500"></textarea>`,
            onSubmit: async values => {
                await api('POST', `/communities/${community_id}/moderation/bans`, {
                    body: {
                        user_id: Number(values.user_id),
                        duration_days: values.duration_days ? Number(values.duration_days) : undefined,
                        reason: values.reason || undefined
                    }
                });
                toast('User banned');
                after();
            }
        });
    }

    function renderNav() {
        const route = location.hash.replace(/^#\/?/, '');
        const link = (href, label, count) => `<a href="#/${href}" class="${route === href ? 'active' : ''}">
            <span>${esc(label)}</span>${count ? `<span class="count">${count}</span>` : ''}</a>`;

        const site = isSiteStaff() ? `
            <div class="nav-title">Site</div>
            ${link('site/dashboard', 'Dashboard', state.open_reports)}
            ${link('site/reports', 'Reports')}
            ${link('site/users', 'Users')}
            ${isAdmin() ? link('site/requests', 'Category requests') : ''}
            ${link('site/log', 'Activity log')}` : '';

        const communities = state.communities.length ? `
            <div class="nav-title">My communities</div>
            ${state.communities.map(community => `
                ${link(`c/${community.id}/overview`, community.title)}`).join('')}` : '';

        const nav = document.getElementById('nav');
        if (nav) { nav.innerHTML = site + communities; }
    }

    function renderShell() {
        $app.innerHTML = `
            <div class="layout">
                <aside class="sidebar">
                    <div class="brand"><span class="brand-mark">P</span> Poneglyph</div>
                    <nav class="nav" id="nav"></nav>
                    <div class="who">Signed in as <b>${esc(state.me.login)}</b> ${badge(state.me.role)}
                        <div style="margin-top:8px"><button class="btn small" id="logout">Sign out</button></div>
                    </div>
                </aside>
                <main class="main" id="main"></main>
            </div>`;
        document.getElementById('logout').addEventListener('click', async () => {
            try { await api('POST', '/auth/logout'); } catch (error) { }
            logout();
        });
        renderNav();
    }

    const communityTabs = id => `
        <div class="row-actions" style="margin-bottom:16px">
            ${[['overview', 'Overview'], ['reports', 'Reports'], ['bans', 'Bans'], ['requests', 'Category requests'], ['log', 'Activity']]
        .map(([tab, label]) => `<a class="btn small ${location.hash === `#/c/${id}/${tab}` ? 'primary' : ''}" href="#/c/${id}/${tab}">${label}</a>`).join('')}
        </div>`;

    async function route() {
        if (!state.me) { return; }
        const main = document.getElementById('main');
        const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

        if (parts.length === 0) {
            location.hash = isSiteStaff() ? '#/site/dashboard' : (state.communities.length ? `#/c/${state.communities[0].id}/overview` : '#/none');
            return;
        }
        renderNav();

        try {
            if (parts[0] === 'site' && isSiteStaff()) {
                const page = parts[1];
                if (page === 'dashboard') { return await siteDashboard(main); }

                const defs = {
                    reports: { title: 'Reports', subtitle: 'Complaints from every community', view: reportsView('site-reports', null) },
                    users: { title: 'Users', subtitle: isAdmin() ? 'Accounts, roles and suspensions' : 'Accounts (emails are hidden for moderators)', view: usersView() },
                    requests: { title: 'Category requests', subtitle: 'Global and local category requests', view: requestsView('site-requests', null) },
                    log: { title: 'Activity log', subtitle: 'What moderators and admins did', view: logView('site-log', null) }
                };
                const def = defs[page];
                if (!def || (page === 'requests' && !isAdmin())) { main.innerHTML = '<div class="empty">Page not found.</div>'; return; }

                main.innerHTML = pageShell({ title: def.title, subtitle: def.subtitle, body: '<div id="view"></div>' });
                return await def.view(main.querySelector('#view'));
            }

            if (parts[0] === 'c' && parts[1]) {
                const id = Number(parts[1]);
                const community = state.communities.find(item => item.id === id);
                const name = community ? community.title : `Community ${id}`;
                const tab = parts[2] || 'overview';

                if (tab === 'overview') {
                    await communityOverview(main, id, name);
                    main.insertAdjacentHTML('afterbegin', communityTabs(id));
                    return;
                }

                const defs = {
                    reports: { title: 'Reports', view: reportsView(`c${id}-reports`, { community_id: id }) },
                    bans: { title: 'Bans', view: bansView(id), actions: '<button class="btn primary" id="new-ban">Ban a user</button>' },
                    requests: { title: 'Category requests', view: requestsView(`c${id}-requests`, { community_id: id }) },
                    log: { title: 'Activity', view: logView(`c${id}-log`, { community_id: id }) }
                };
                const def = defs[tab];
                if (!def) { main.innerHTML = '<div class="empty">Page not found.</div>'; return; }

                main.innerHTML = communityTabs(id) + pageShell({ title: `${name}: ${def.title}`, actions: def.actions || '', body: '<div id="view"></div>' });
                const rerender = () => route();
                const banButton = main.querySelector('#new-ban');
                if (banButton) { banButton.addEventListener('click', () => openBanForm(id, rerender)); }
                return await def.view(main.querySelector('#view'));
            }

            main.innerHTML = `<div class="empty">${state.communities.length || isSiteStaff()
                ? 'Choose a section on the left.'
                : 'You are not a moderator of any community and not site staff, so there is nothing to manage here.'}</div>`;
        } catch (error) {
            main.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
        }
    }

    async function loadSession() {
        const payload = JSON.parse(atob(state.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const me = await api('GET', `/users/${payload.id}`);
        state.me = { id: me.id, login: me.login, role: me.role };

        if (isAdmin()) {
            const all = await api('GET', '/communities', { query: { limit: 100, sort: 'title' } });
            state.communities = all.data.map(item => ({ id: item.id, title: item.title }));
        } else {
            const mine = await api('GET', `/users/${me.id}/communities`, { query: { limit: 100 } });
            state.communities = mine.data
                .filter(item => item.member_role === 'OWNER' || item.member_role === 'MODERATOR')
                .map(item => ({ id: item.id, title: item.title }));
        }
    }

    function renderLogin() {
        $app.innerHTML = `
            <div class="login-wrap"><form class="login-card" id="login-form">
                <h1>Poneglyph</h1>
                <p>Admin and moderation panel</p>
                <label>Login or email</label><input name="login" autocomplete="username" required>
                <label>Password</label><input name="password" type="password" autocomplete="current-password" required>
                <div style="margin-top:18px"><button class="btn primary" style="width:100%;justify-content:center">Sign in</button></div>
            </form></div>`;

        document.getElementById('login-form').addEventListener('submit', async event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.target).entries());
            try {
                const result = await api('POST', '/auth/login', { body: values });
                state.token = result.token;
                storage.set('usof_token', result.token);
                await start();
            } catch (error) {
                toast(error.message, 'error');
            }
        });
    }

    async function start() {
        if (!state.token) { return renderLogin(); }
        try {
            await loadSession();
        } catch (error) {
            toast(error.message, 'error');
            return logout();
        }
        renderShell();
        route();
    }

    window.addEventListener('hashchange', route);
    start();
}());
