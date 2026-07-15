import { Tag } from "antd";
import { useLabels } from "@/api/labels";
import { colorOf } from "@/colors";

interface EnumTagProps {
  /** 枚举名，用于查中文展示名（如 "Orientation"）。 */
  enumName: string;
  value: string;
  /** 取值到颜色的映射表（来自 colors.ts）。 */
  colorMap?: Record<string, string>;
}

/** 依据枚举取值渲染带颜色的中文标签。 */
export function EnumTag({ enumName, value, colorMap }: EnumTagProps) {
  const { label } = useLabels();
  const color = colorMap ? colorOf(colorMap, value) : "default";
  return <Tag color={color}>{label(enumName, value)}</Tag>;
}
