打矢量突破这类活动，最烦的是算补给关：一关关的补给关（游戏里叫「特别战线」）到底要打哪几个、谁得先打谁、打哪一关会把别的关要用的干员占掉——以前这些得自己在游戏里一关关对着找，所以我写了个插件，让它替我算。下面按我平时用的顺序走一遍。

**【先看我平时怎么用】**

**1. 分析完，先看它认了哪几关**

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/0c87c0df58fce5d9beb7d0d41d1cc26c.png?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/e4f211f06f0ff9655240f30e9ddea0ed.jpeg?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

打开插件，把特别战线那一屏截进去（或直接粘贴截图），它会按**序号**认关（顺序 = 从上到下、从左到右），而且把认的依据也写出来——比如「特别战线网格第 5 格 → VEC-SP02，格内文字『催化装备』」。**认错了你一眼就能看出来**。

**2. 不太确定，就点「选择补给关…」自己挑**

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/55ab80dde4f3b4fecf44b3472f204f51.png?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

点了会打开一个按**序号**排的补给网格，像游戏里那样点：**按住拖动可以连续选**，已经在池里的默认勾着（取消它 = 这关识别错了，应用后会从列表移除）。识别不准或者漏关，直接在这儿挑。

**3. 再看有没有漏掉的关**

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/e428f30a89de2ba956febc9144f4f1e1.png?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/adfb56c8312eb81b7d537efaad790b21.png?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

认出来的每一关都会给一份候选池（MAA 作业站 + B站 攻略视频，两条来源分开标）。漏了就拉到底下的「＋ 补一个关…」——**它只列当前还没出现的关**，选一个就现查它的方案；认错了的关用「不是这关」去掉。

**【结果页左右两栏是什么】**

**4. 大窗口：左边是补给关候选池，右边是本关阵容**

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/72707cd58098a149a348df6ea071a7dd.png?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

点「⤢ 大窗口查看结果」开一个独立窗口，一屏看全：**左栏补给关候选池（勾选就在这儿）、右栏本关阵容**；和视频页面板/扩展弹窗的勾选**双向实时同步**，视频页关掉它也自己关。

**【结论是怎么来的、怎么交互】**

**5. 勾一套方案 = 这一关占用这些干员**

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/3233f9787900940b31ea0867b4cb9568.png?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

勾上之后，这套方案的干员被登记成**占用**；其它关里用到同一个干员的方案会**灰掉 + 删除线 + 锁**，行尾还写着「⚠ 凯尔希 已被 VEC-SP02 占用——勾选本方案会把占用改到本关」，点它就能把占用"抢"回来。**结果区实时跟着变，不用重新分析。**

**6. 缺干员的方案默认藏着，但能点开看**

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/17be2bf37cdffdd87d15a05a42198670.png?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

![img](https://imgheybox.max-c.com/web/bbs/2026/10/09/b410d94bdaa03bf7a531ce3588e9b8c1.png?imageMogr2/format/webp/quality/75/ignore-error/1/auto-orient)

藏起来的是"你练度表里没有的干员"那类方案，点「点开查看」能扫一眼，心里有数（自己搜到的攻略可能就在里面）。

**7. 补给关之间的先后顺序，它也替你记着**

有些补给关**要先打掉前置关才能开**（实测：SP10 要先打 SP09、SP12 要先打 SP11），而打前置关同样要占干员。所以只要识别到后置关，它会**自动把前置关也加进候选池**，并注明「关卡链：本关需要先打 VEC-SP09」——省得排完阵容才发现少算了一关。

**8. 识别本身是怎么做的**

> 它是靠模型读图的：同一张图多跑几次，结果可能有点出入（走网页版尤其看当时的算力），所以插件里凡是识别出来的结论都能手动改——「不是这关」「选择补给关…」「点开查看」都是为这个准备的。
>
> 另外截图**不用按固定顺序**摆，没有"第一张必须是补给界面、第二张必须是编队"这种死规定，它按画面内容自己判断哪张是什么，你截图的顺序怎么顺手怎么来。

**【最后：下载和杂七杂八】**

**9. 一些顺手做的**

- 换视频/换分P 不再串上一个视频的结果；
- 结果按「视频 + 分P」缓存，可以「清除本页缓存」重来；
- 启动会读一下仓库里的公告（有更新、有坑都会在这儿说一声）；
- 发现新版会在面板顶部提示，附「复制升级步骤」。

插件免费开源，也不碰账号：B站只读公开的弹幕和评论，练度表在本地解析、不上传。下载和安装步骤我放在评论区置顶。

原创
