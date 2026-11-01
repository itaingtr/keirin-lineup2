(async () => {
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.118.0');

const SUPABASE_URL = 'https://ritinxywblgsccjvqoeh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_L6u3c3sOBRmAPHI2jLqcGQ_x0VlpQnh';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sb-ritinxywblgsccjvqoeh-auth-token'}});
const BOARD_EMAIL = "cat-board-c39688cd6ba7@keirin-lineup.invalid";
const PASSPHRASE_DOMAIN = "keirin-lineup2:board:v1:cat-board-c39688cd6ba7@keirin-lineup.invalid";
const root = document.getElementById('rows');
if (!root) throw new Error('Race list #rows was not found');

const html = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const authBar = html('section', 'race-comments-auth');
authBar.setAttribute('aria-label', 'コメント掲示板ログイン');
const authHeading = html('strong', 'race-comments-auth-title', '猫の掲示板');
const authMessage = html('span', 'race-comments-auth-status', 'コメントは誰でも読めるにゃ');
const passphrase = html('input', 'race-comments-code');
passphrase.type = 'password';
passphrase.autocomplete = 'current-password';
passphrase.autocapitalize = 'none';
passphrase.spellcheck = false;
passphrase.style.fontSize = '16px';
passphrase.placeholder = '合言葉';
passphrase.setAttribute('aria-label', '掲示板の合言葉');
const login = html('button', 'race-comments-auth-button', 'ログイン');
login.type = 'button';
const signOut = html('button', 'race-comments-auth-button race-comments-signout', 'ログアウト');
signOut.type = 'button';
signOut.hidden = true;
authMessage.setAttribute('role', 'status');
authBar.append(authHeading, authMessage, passphrase, login, signOut);
(document.getElementById('comments-auth-slot') || document.querySelector('main')).append(authBar);

const raceRows = new Map();
const commentCells = new Map();
let currentUser = null;
let canWrite = false;
let commentCache = [];
const board = window.keirinBoard = {
  client: supabase, user: null, canWrite: false, ready: false,
  requestLogin() {
    authBar.scrollIntoView?.({block: 'center', behavior: 'smooth'});
    passphrase.focus({preventScroll: true});
  },
};

function raceKeyFor(row) {
  const link = row.querySelector('td.race .race-link');
  if (!link) return null;
  return link.dataset.commentKey || new URL(link.href, location.href).pathname;
}

function attachRow(row) {
  if (row.querySelector('.race-comment-cell')) return;
  const key = raceKeyFor(row);
  if (!key) return;
  const cell = html('td', 'race-comment-cell');
  const feed = html('div', 'race-comment-feed');
  const form = html('form', 'race-comment-form');
  const input = html('textarea', 'race-comment-input');
  input.maxLength = 2000;
  input.placeholder = 'このレースの予想や気づき';
  input.setAttribute('aria-label', 'このレースへのコメント');
  const submit = html('button', 'race-comment-save', '投稿');
  submit.type = 'submit';
  const formStatus = html('span', 'race-comment-status');
  form.append(input, submit, formStatus);
  form.hidden = !canWrite;
  cell.append(feed, form);
  row.append(cell);
  raceRows.set(key, row);
  commentCells.set(key, { cell, feed, form, input, submit, formStatus });
  form.addEventListener('submit', event => postComment(event, key));
}

async function loadComments() {
  const { data, error } = await supabase
    .from('race_comments')
    .select('id, race_key, body, user_id, created_at')
    .not('race_key', 'like', 'condition:v1:%')
    .order('created_at', { ascending: true });
  if (error) {
    authMessage.textContent = 'コメントを読み込めなかったにゃ。時間をおいて再読み込みしてにゃ';
    return;
  }
  commentCache = data || [];
  renderComments();
}

function renderComments() {
  for (const [, parts] of commentCells) parts.feed.replaceChildren();
  for (const item of commentCache) {
    const parts = commentCells.get(item.race_key);
    if (!parts) continue;
    const post = html('article', 'race-comment-post');
    post.append(html('span', 'race-comment-body', item.body));
    const time = new Date(item.created_at);
    post.append(html('time', 'race-comment-time', new Intl.DateTimeFormat('ja-JP', {
      timeStyle: 'short', timeZone: 'Asia/Tokyo'
    }).format(time)));
    parts.feed.append(post);
  }
}

async function refreshPermission() {
  currentUser = (await supabase.auth.getUser()).data.user;
  canWrite = false;
  let permissionError = false;
  if (currentUser) {
    const { data, error } = await supabase.rpc('is_race_comment_writer');
    canWrite = !error && data === true;
    permissionError = Boolean(error);
  }
  authMessage.textContent = canWrite ? 'ログイン中にゃ。投稿できるにゃ' : permissionError ? '投稿の接続を確認できなかったにゃ。もう一度ログインしてにゃ' : '合言葉でログインすると投稿できるにゃ';
  passphrase.hidden = canWrite;
  login.hidden = canWrite;
  signOut.hidden = !currentUser;
  for (const [, parts] of commentCells) parts.form.hidden = !canWrite;
  Object.assign(board, {user: currentUser, canWrite, ready: true});
  window.dispatchEvent(new CustomEvent('keirin-board-state'));
}

async function postComment(event, key) {
  event.preventDefault();
  const parts = commentCells.get(key);
  const body = parts.input.value.trim();
  if (!body || !currentUser || !canWrite) return;
  parts.submit.disabled = true;
  parts.formStatus.textContent = '投稿中にゃ…';
  const { error } = await supabase.from('race_comments').insert({
    race_key: key,
    body,
    user_id: currentUser.id,
  });
  parts.submit.disabled = false;
  if (error) {
    parts.formStatus.textContent = '投稿できなかったにゃ';
    return;
  }
  parts.input.value = '';
  parts.formStatus.textContent = '投稿したにゃ';
  await loadComments();
}

async function loginWithPassphrase() {
  if (login.disabled) return;
  const phrase = passphrase.value.normalize('NFKC').trim();
  if (!phrase) { authMessage.textContent = '合言葉を入れてにゃ'; return; }
  login.disabled = true;
  authMessage.textContent = 'ログイン中にゃ…';
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PASSPHRASE_DOMAIN + '\0' + phrase));
    const password = 'Neko-' + Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('') + '9!';
    const { error } = await supabase.auth.signInWithPassword({email: BOARD_EMAIL, password});
    if (error) { authMessage.textContent = error.status === 429 ? '少し待ってから、もう一度試してにゃ' : '合言葉を確認して、もう一度入れてにゃ'; return; }
    passphrase.value = '';
    await refreshPermission();
    await loadComments();
  } catch (_) {
    authMessage.textContent = '接続を確認して、もう一度試してにゃ';
  } finally {
    login.disabled = false;
  }
}
login.addEventListener('click', loginWithPassphrase);
passphrase.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); loginWithPassphrase(); }
});

signOut.addEventListener('click', async () => {
  await supabase.auth.signOut({scope: 'local'});
  await refreshPermission();
});

const attachAll = () => { root.querySelectorAll('tr').forEach(attachRow); renderComments(); };
attachAll();
new MutationObserver(attachAll).observe(root, { childList: true });
await refreshPermission();
await loadComments();
supabase.auth.onAuthStateChange(() => {
  setTimeout(async () => {
    await refreshPermission();
    await loadComments();
  }, 0);
});
})();
