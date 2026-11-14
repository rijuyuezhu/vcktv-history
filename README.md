# VC-KTV History

静态的 VC-KTV 公开历史歌单浏览器。独立于 VC-KTV 后端，无登录、点歌、播放或管理功能。

## 生成快照

在有 VC-KTV 数据的机器上运行：

```sh
python3 scripts/export.py --data-root ~/.local/share/vc-ktv
python3 -m http.server 8789 --bind 127.0.0.1
```

打开 http://127.0.0.1:8789/ 。仅导出已关闭且标记为公开的场次。生成的 `data/` 和 `covers/` 是纯静态资源，不包含音视频、歌词、管理员配置或数据库。

第三方场次歌单链接在 `config/playlists.json` 中配置，重新运行导出即可更新页面。封面采用已有的本地缓存，不访问媒体 API。没有缓存的封面会报告错误。

部署到 GitHub Pages 时，发布仓库根目录即可；页面资源均为相对路径，支持仓库子路径。发布前检查歌名、点歌者昵称等内容是否适合公开，尤其注意 Git 历史无法撤回已发布数据。
