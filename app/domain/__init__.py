"""领域模型与枚举。

该层不依赖 UI 或具体存储实现，只描述数据集的核心概念：
图片、人脸、人物、标签、Caption、Selection 等。
"""

from app.domain import enums, models

__all__ = ["enums", "models"]
