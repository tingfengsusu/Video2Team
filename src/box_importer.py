"""box 导入：v1 一图流 Excel，v2 森空岛扫码（见 docs/design.md §3.2）。

- v1：解析 ark.yituliu.cn「我的干员 → 导出为 Excel」的练度表，标准输入格式；
- v2：森空岛扫码 → 自动获取 cred → 签名调 API 拉干员数据
  （协议参考 https://github.com/ProbiusOfficial/Skland_API）；
- cred 仅内存使用、不落盘（或显式加密存储并告知用户）；
- Excel 导入永久保留为兜底（森空岛接口是社区逆向，存在被限制风险）。
"""

from src.models import Box


def import_from_excel(path: str) -> Box:
    """解析一图流导出的 Excel 练度表（干员名/精英化/等级/专精）。"""
    raise NotImplementedError("v0 首要任务：确定一图流 Excel 的实际列格式")


def import_from_skland() -> Box:
    """v2：森空岛扫码登录，自动获取 cred 并拉取绑定账号的干员数据。"""
    raise NotImplementedError("v2")
