const app = document.getElementById("app");
const base = new URL(".", import.meta.url);
const labels = {
  played: "已唱",
  skipped: "已跳过",
  cancelled: "已取消",
  closed_unplayed: "散场未唱",
  closed_interrupted: "散场中断"
};
const eventIdPattern = /^[a-zA-Z0-9_-]{1,60}$/;
const events = new Map();
let index = null;
let viewVersion = 0;
let eventSearch = "";
let toastTimer;

function node(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function add(parent, tag, className = "", text) {
  const element = node(tag, className, text);
  parent.append(element);
  return element;
}
function asset(path) {
  return new URL(path, base).href;
}
async function json(path) {
  const response = await fetch(asset(path));
  if (!response.ok) throw new Error("读取失败");
  return response.json();
}
function toast(message) {
  const el = document.getElementById("toast");
  clearTimeout(toastTimer);
  el.textContent = message;
  el.className = "show";
  toastTimer = setTimeout(() => { el.className = ""; }, 3000);
}
async function copy(text, label) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error("Clipboard unavailable");
    toast("已复制" + label);
  } catch {
    const field = add(document.body, "textarea", "clipboard-field");
    field.value = text;
    let success = false;
    try {
      field.select();
      success = document.execCommand("copy");
    } catch {
      // Fall through to the native copy prompt.
    } finally {
      field.remove();
    }
    if (success) toast("已复制" + label);
    else prompt("复制" + label, text);
  }
}
function sourceUrl(song) {
  if (song.source_type === "netease" && /^\d+$/.test(String(song.source_id || "")))
    return "https://music.163.com/#/song?id=" + encodeURIComponent(song.source_id);
  if (song.bvid && /^BV[a-zA-Z0-9]+$/.test(song.bvid))
    return "https://www.bilibili.com/video/" + encodeURIComponent(song.bvid)
      + "/?p=" + (song.page || 1);
  return "";
}
function icon(name) {
  const el = node("img", "action-icon");
  el.src = asset("icons/" + name + ".svg");
  el.alt = "";
  el.setAttribute("aria-hidden", "true");
  return el;
}
function sourceTag(parent, song) {
  const tag = add(parent, "span", "source-tag");
  tag.append(icon(song.source_type === "netease" ? "neteasecloudmusic" : "bilibili"));
  add(tag, "span", "", song.source_type === "netease" ? "网易云" : "B站");
}
function pathEvent(id) { return "#/event/" + id; }
function pathSong(eventId, songId) { return "#/song/" + eventId + "/" + songId; }

function subpage(title, back) {
  app.replaceChildren();
  const header = add(app, "div", "section-head subpage-head");
  if (back) {
    const link = add(header, "a", "btn neutral icon-back", "‹");
    link.href = back;
    link.setAttribute("aria-label", "返回");
    link.title = "返回";
  }
  add(header, "h1", "", title);
}
function eventRow(list, event) {
  const row = add(list, "a", "song-item archive-entry");
  row.href = pathEvent(event.id);
  add(row, "strong", "event-title", event.name);
  add(row, "small", "event-meta", String(event.created_at || event.closed_at || "").slice(0, 10));
  add(row, "span", "song-chevron", "›");
}
function renderEvents() {
  subpage("场次列表", null);
  const section = add(app, "section", "panel");
  const search = add(section, "input", "search");
  search.type = "search";
  search.placeholder = "搜索场次";
  search.setAttribute("aria-label", "搜索公开历史场次");
  search.value = eventSearch;
  const list = add(section, "div", "archive-list");
  const draw = () => {
    list.replaceChildren();
    const found = index.events.filter((event) =>
      event.name.toLocaleLowerCase().includes(eventSearch.trim().toLocaleLowerCase()));
    if (!found.length) add(list, "div", "empty", "暂无匹配场次");
    for (const event of found) eventRow(list, event);
  };
  search.oninput = () => { eventSearch = search.value; draw(); };
  draw();
}
function playlistLinks(section, data) {
  if (!data.playlists?.length) return;
  const bar = add(section, "div", "playlist-bar");
  add(bar, "strong", "", "本次 KTV 的歌单");
  for (const item of data.playlists) {
    const link = add(bar, "a", "playlist-link");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(icon(item.platform === "netease" ? "neteasecloudmusic" : "bilibili"));
    add(link, "span", "", item.label);
  }
}
function renderSongRow(list, song, eventId) {
  const row = add(list, "a", "song-item song-row");
  row.href = pathSong(eventId, song.id);
  row.setAttribute("aria-label", song.title + "，点歌者 " + (song.requester || "未知") + "，" + (labels[song.status] || "") + "，查看详情");
  add(row, "span", "ordinal", String(song.order));
  const info = add(row, "span", "song-copy");
  add(info, "strong", "", song.title + (song.source_type !== "netease" && song.page > 1 ? " (P" + song.page + ")" : ""));
  const meta = add(info, "span", "song-meta");
  add(meta, "span", "song-requester", song.requester || "未知点歌者");
  add(meta, "span", "song-meta-separator", "|");
  add(meta, "span", "song-author", song.uploader || "未知作者");
  sourceTag(meta, song);
  add(row, "span", "song-state", labels[song.status] || song.status);
  add(row, "span", "song-chevron", "›");
}
function renderEvent(data) {
  subpage("场次歌单", "#/");
  const section = add(app, "section", "panel");
  const head = add(section, "div", "section-head");
  add(head, "h2", "", data.event.name);
  const meta = add(section, "div", "detail-meta");
  if (data.event.created_at) add(meta, "span", "", String(data.event.created_at).slice(0, 10));
  add(meta, "span", "", "已散场");
  playlistLinks(section, data);
  const list = add(section, "div", "song-list archive-song-list");
  if (!data.songs.length) add(list, "div", "empty", "暂无歌曲");
  for (const song of data.songs) renderSongRow(list, song, data.event.id);
}
function action(row, label, iconName, callback) {
  const button = add(row, "button", "btn neutral");
  button.type = "button";
  button.append(icon(iconName));
  add(button, "span", "", label);
  button.onclick = callback;
}
function link(row, label, url) {
  const element = add(row, "a", "btn neutral");
  element.href = url;
  element.target = "_blank";
  element.rel = "noopener noreferrer";
  element.append(icon("external-link"));
  add(element, "span", "", label);
}
function duration(seconds) {
  const n = Math.round(Number(seconds) || 0);
  return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
}
function renderSong(data, song) {
  subpage("歌曲详情", pathEvent(data.event.id));
  const panel = add(app, "section", "panel song-detail-panel");
  const head = add(panel, "div", "detail-header");
  if (song.cover) {
    const image = add(head, "img", "detail-cover");
    image.alt = "";
    image.loading = "lazy";
    image.src = asset(song.cover);
    image.onerror = () => image.replaceWith(node("div", "detail-cover detail-placeholder", "♫"));
  } else add(head, "div", "detail-cover detail-placeholder", "♫");
  const info = add(head, "div", "detail-info");
  add(info, "h2", "", song.title);
  const meta = add(info, "div", "detail-meta");
  add(meta, "span", "", song.uploader || "未知作者");
  sourceTag(meta, song);
  add(info, "div", "detail-byline", "点歌者 " + (song.requester || "未知") + "　" + duration(song.duration));
  const state = add(panel, "div", "detail-state");
  add(state, "strong", "", labels[song.status] || song.status);

  const row = add(panel, "div", "detail-section");
  add(row, "h3", "", "来源");
  const tools = add(row, "div", "detail-tools");
  if (song.bvid) action(tools, "复制 BV", "copy", () => copy(song.bvid, "BV 号"));
  else if (song.source_type === "netease" && song.source_id)
    action(tools, "复制 ID", "copy", () => copy(String(song.source_id), "歌曲 ID"));
  const url = sourceUrl(song);
  if (url) {
    action(tools, "复制链接", "copy", () => copy(url, "链接"));
    link(tools, "打开来源", url);
  }
  if (!tools.childElementCount) row.remove();
}
async function navigate() {
  const version = ++viewVersion;
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (!index) index = await json("data/events.json");
    if (version !== viewVersion) return;
    if (parts.length === 1 && !parts[0]) renderEvents();
    else if (
      (parts[0] === "event" && parts.length === 2) ||
      (parts[0] === "song" && parts.length === 3 && /^[1-9]\d*$/.test(parts[2]))
    ) {
      const id = parts[1];
      if (!eventIdPattern.test(id) || !index.events.some((event) => event.id === id))
        throw new Error("场次不存在");
      if (!events.has(id)) events.set(id, await json("data/events/" + id + ".json"));
      if (version !== viewVersion) return;
      const data = events.get(id);
      if (parts[0] === "event") renderEvent(data);
      else {
        const song = data.songs.find((item) => item.id === Number(parts[2]));
        if (!song) throw new Error("歌曲不存在");
        renderSong(data, song);
      }
    } else throw new Error("页面不存在");
    document.title = (app.querySelector("h1")?.textContent || "场次列表") + " | VC-KTV";
    window.scrollTo(0, 0);
  } catch (error) {
    if (version !== viewVersion) return;
    subpage("场次列表", null);
    add(app, "div", "empty", error.message);
  }
}
window.addEventListener("hashchange", navigate);
navigate();
