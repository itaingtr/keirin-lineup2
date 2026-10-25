(async () => {
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');

const SUPABASE_URL = 'https://ritinxywblgsccjvqoeh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_L6u3c3sOBRmAPHI2jLqcGQ_x0VlpQnh';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
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
const email = html('input', 'race-comments-email');
email.type = 'email';
email.autocomplete = 'email';
email.placeholder = '猫のメールアドレス';
email.setAttribute('aria-label', 'ログイン用メールアドレス');
const sendCode = html('button', 'race-comments-auth-button', 'ログインリンクを送る');
sendCode.type = 'button';
const signOut = html('button', 'race-comments-auth-button race-comments-signout', 'ログアウト');
signOut.type = 'button';
signOut.hidden = true;
authBar.append(authHeading, authMessage, email, sendCode, signOut);
(document.getElementById('comments-auth-slot') || document.querySelector('main')).append(authBar);

const raceRows = new Map();
const commentCells = new Map();
let currentUser = null;
let canWrite = false;

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
  form.hidden = true;
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
    .order('created_at', { ascending: true });
  if (error) {
    authMessage.textContent = 'コメントを読み込めなかったにゃ。時間をおいて再読み込みしてにゃ';
    return;
  }
  for (const [, parts] of commentCells) parts.feed.replaceChildren();
  for (const item of data || []) {
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
  if (currentUser) {
    const { data, error } = await supabase.rpc('is_race_comment_writer');
    canWrite = !error && data === true;
  }
  if (!currentUser) {
    authMessage.textContent = 'コメントは誰でも読めるにゃ。投稿するには猫ログインが必要にゃ';
    email.hidden = false;
    sendCode.hidden = false;
    signOut.hidden = true;
  } else if (canWrite) {
    authMessage.textContent = '猫としてログイン中にゃ。どの端末からのコメントも共有されるにゃ';
    email.hidden = true;
    sendCode.hidden = true;
    signOut.hidden = false;
  } else {
    authMessage.textContent = 'ログインできたにゃ。投稿権限の登録があと一つ必要にゃ';
    email.hidden = true;
    sendCode.hidden = true;
    signOut.hidden = false;
  }
  for (const [, parts] of commentCells) parts.form.hidden = !canWrite;
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

sendCode.addEventListener('click', async () => {
  const address = email.value.trim();
  if (!address) {
    authMessage.textContent = 'メールアドレスを入れてにゃ';
    return;
  }
  sendCode.disabled = true;
  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    options: { emailRedirectTo: 'https://itaingtr.github.io/keirin-lineup/' },
  });
  sendCode.disabled = false;
  if (error) {
    authMessage.textContent = 'コードを送れなかったにゃ。メールアドレスを確認してにゃ';
    return;
  }
  authMessage.textContent = 'メールを送ったにゃ。届いたログインリンクを押してにゃ';
});

signOut.addEventListener('click', async () => {
  await supabase.auth.signOut();
  await refreshPermission();
});

const attachAll = () => root.querySelectorAll('tr').forEach(attachRow);
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
