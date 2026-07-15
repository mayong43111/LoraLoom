import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Radio,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useLabels } from "@/api/labels";
import { PageHeader } from "@/components/PageHeader";

const OPTIONS = [
  { key: "caption", label: "包含 Caption 文本", default: true },
  { key: "label", label: "包含 Label 标签", default: true },
  { key: "thumbnail", label: "导出缩略图", default: false },
  { key: "metrics", label: "包含质量指标", default: false },
];

export function ExportPage() {
  const { entries } = useLabels();
  const formats = entries("ExportFormat");
  const firstMvp = formats.find((f) => f.isMvp)?.value ?? "jsonl";
  const [format, setFormat] = useState(firstMvp);
  const [options, setOptions] = useState<string[]>(
    OPTIONS.filter((o) => o.default).map((o) => o.key),
  );

  const previewLines = [
    "{",
    '  "image": "img-0001.jpg",',
    `  "caption": "a photo of a person, front view",`,
    options.includes("label")
      ? '  "label": {"orientation": "front", "usability": "trainable"},'
      : undefined,
    options.includes("metrics")
      ? '  "quality": {"score": 0.86, "blur": 0.12},'
      : undefined,
    "}",
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="导出"
        subtitle="导出训练集"
        extra={
          <Tooltip title="接入后端后可执行导出">
            <Button type="primary" disabled>
              开始导出
            </Button>
          </Tooltip>
        }
      />
      <Row gutter={16}>
        <Col xs={24} md={14}>
          <Card title="导出格式" size="small">
            <Radio.Group
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <Space direction="vertical">
                {formats.map((f) => (
                  <Radio key={f.value} value={f.value} disabled={!f.isMvp}>
                    {f.label}
                    {!f.isMvp && (
                      <Tag color="default" style={{ marginLeft: 8 }}>
                        第二阶段
                      </Tag>
                    )}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>

            <Divider />

            <Typography.Text strong>导出内容</Typography.Text>
            <div style={{ marginTop: 12 }}>
              <Checkbox.Group
                value={options}
                onChange={(v) => setOptions(v as string[])}
              >
                <Space direction="vertical">
                  {OPTIONS.map((o) => (
                    <Checkbox key={o.key} value={o.key}>
                      {o.label}
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card title="预览" size="small">
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                color: "#c8ccd8",
                whiteSpace: "pre-wrap",
              }}
            >
              {previewLines.join("\n")}
            </pre>
          </Card>
        </Col>
      </Row>
    </>
  );
}
