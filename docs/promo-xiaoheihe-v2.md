# 小黑盒发帖 · 配套清单（v0.3.0）

> **成稿（可直接导入小黑盒）在另一个文件**：[`promo-xiaoheihe-post.md`](promo-xiaoheihe-post.md)
> —— 标题、正文、图片链接都在里面；本文件只放**截图清单、图片地址映射、发帖注意事项**。
>
> **发布前必须做的两件事**：① GitHub Releases 建 `v0.3.0`，上传仓库根目录已打好的 `Video2Team_v0.3.0.zip`；
> ② 蓝奏云重新上传这版 zip，把成稿里 `<把新包传上去后替换这里>` 换成新链接。

---

## 图片：本地文件 ↔ 线上地址

图片已上传到图片仓库 **`tingfengsusu/photo`**（路径 `video2team/v0.3.0/`），成稿里用的就是下面的 raw 地址。

| 成稿里的位置 | 本地参考图（docs/promo-images-v2/） | 线上地址 |
|---|---|---|
| 第 1 张 | `01-pool-occupied.png` | https://raw.githubusercontent.com/tingfengsusu/photo/main/video2team/v0.3.0/01-pool-occupied.png |
| 第 2 张 | `02-overview.png` | https://raw.githubusercontent.com/tingfengsusu/photo/main/video2team/v0.3.0/02-overview.png |
| 第 3 张 | `03-supply-picker.png` | https://raw.githubusercontent.com/tingfengsusu/photo/main/video2team/v0.3.0/03-supply-picker.png |
| 第 4 张 | `04-big-window.png` | https://raw.githubusercontent.com/tingfengsusu/photo/main/video2team/v0.3.0/04-big-window.png |

> ⚠️ 注：`cdn.jsdelivr.net/gh/tingfengsusu/photo@...` 对这个仓库只做 301 跳转到 raw（旧图也一样），
> 所以成稿里直接用 raw 地址；如果你那边 raw 打不开（国内常见），退路是把本地这 4 张图**直接拖进小黑盒编辑器**。

### 换成你的真实截图（链接不用改）

```bash
# 把真图按同名放进 docs/promo-images-v2/（覆盖同名文件），然后：
node scripts/upload-photo.mjs docs/promo-images-v2 video2team/v0.3.0
```

脚本走 GitHub Contents API，**同名会覆盖**——所以成稿里的链接原样可用，不用动 md。
（CDN/浏览器缓存有时会保留旧图，必要时在 URL 后面加 `?v=1009` 强制刷新。）

---

## 📸 截图清单（要截哪 5 张、各自什么状态）

| 序号 | 文件名 | 截什么（把界面调到这个状态再截） |
|---|---|---|
| 图1 | `01-pool-occupied.png` | **补给关候选池 + 跨关占用（做封面）**：真实攻略视频页 → 打开面板 → 候选池里**勾选某一关的一套方案**（如 VEC-SP02）→ 把面板滚到下面几关，拍到「下一关那行被灰掉 + 删除线 + 行尾『⚠ …已被 VEC-SP02 占用——勾选本方案会把占用改到本关』」 |
| 图2 | `02-overview.png` | **结果总览**：同一次分析，面板滚到最上面，拍到「本关用这套（N 人）：…」（绿=你有/红=没有/灰+🔒=已派遣）+「🚩 前置关（派遣占用）」几行 |
| 图3 | `03-supply-picker.png` | **「选择补给关…」浮层**：候选池顶部点开，把序号网格拍全（**最好有两格勾选态**），右下角「已选 N 关（将查询 x / 将移除 y）」也拍进去 |
| 图4 | `04-big-window.png` | **大窗口结果页**：点「⤢ 大窗口查看结果」后截全屏（左候选池、右阵容、顶栏 chips） |
| 图5 | `05-settings.png` | **设置页**（可选；拍好了放进 `docs/promo-images-v2/` 跑一次上传脚本，我再把图位加进成稿）：`chrome://extensions` → 「扩展程序选项」，拍「我的干员 box」+「版本与更新」（显示 v0.3.0）+「公告」 |

**截图小技巧**：1920 宽、别缩放；图1/图2 可以只截右半屏 + 面板（小黑盒会压图，太大字看不清）。

---

## 发帖注意事项

- **封面**：图1（红绿 + 置灰对比最有信息量）；备选图4。
- **旧帖怎么处理**：只改旧帖首行加一句
  `⚠️ 已更新到 v0.3.0（补给关自动识别 / 关卡链 / 大窗口），新帖：<新帖链接>`，
  正文与评论区不再维护；**不要**把新帖写成"接上一帖"的补丁帖（新读者多半来自推荐/搜索，要能独立读懂）。
- **评论区自己置顶一条**：下载链接（GitHub + 蓝奏云）+ 一句 FAQ「装完先在设置里导练度表，不然名字全是红的」；
  再加一句「升级只需覆盖文件夹后点刷新，不用卸载重装」。
- **二次曝光**：编辑老帖基本不给新曝光，想要再被刷到就发新帖——这也是建议发新帖的原因。
- 发完把帖子链接发我，我整理一份 FAQ（装不上 / 杀毒误报 / 练度表格式变了 / 勾选没反应）供你置顶。
