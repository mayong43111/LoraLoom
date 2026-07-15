import { useState } from "react";
import { Card, Col, List, Progress, Row, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { ORIENTATION_COLOR, SELECTION_COLOR } from "@/colors";
import type { Selection, SelectionRule } from "@/api/types";

interface RuleRow extends SelectionRule {
  matched: number;
  gap: number;
}

function RuleTable({ selection }: { selection: Selection }) {
  const counts = new Map<string, number>();
  for (const item of selection.items) {
    counts.set(item.rule_key, (counts.get(item.rule_key) ?? 0) + 1);
  }
  const rows: RuleRow[] = selection.rules.map((rule) => {
    const matched = counts.get(rule.key) ?? 0;
    return { ...rule, matched, gap: Math.max(0, rule.target_count - matched) };
  });

  const columns: ColumnsType<RuleRow> = [
    { title: "人物", dataIndex: "subject_id", key: "subject_id" },
    {
      title: "朝向",
      dataIndex: "orientation",
      key: "orientation",
      render: (v: string) => (
        <EnumTag enumName="Orientation" value={v} colorMap={ORIENTATION_COLOR} />
      ),
    },
    { title: "目标", dataIndex: "target_count", key: "target", align: "right" },
    { title: "已选", dataIndex: "matched", key: "matched", align: "right" },
    {
      title: "缺口",
      dataIndex: "gap",
      key: "gap",
      align: "right",
      render: (v: number) =>
        v > 0 ? <Tag color="warning">{v}</Tag> : <Tag color="success">0</Tag>,
    },
    {
      title: "完成度",
      key: "progress",
      width: 160,
      render: (_: unknown, row) => (
        <Progress
          percent={Math.min(100, Math.round((row.matched / row.target_count) * 100))}
          size="small"
        />
      ),
    },
    {
      title: "最低质量",
      dataIndex: "min_quality",
      key: "min_quality",
      align: "right",
      render: (v: number) => v.toFixed(2),
    },
    {
      title: "约束",
      key: "constraints",
      render: (_: unknown, row) => (
        <Space size={4} wrap>
          {row.require_reviewed && <Tag>已复核</Tag>}
          {row.require_trainable && <Tag>可训练</Tag>}
          {row.exclude_duplicates && <Tag>去重</Tag>}
        </Space>
      ),
    },
  ];

  return (
    <Table
      rowKey="key"
      columns={columns}
      dataSource={rows}
      pagination={false}
      size="small"
    />
  );
}

function SelectionContent({ selections }: { selections: Selection[] }) {
  const [selectedId, setSelectedId] = useState(selections[0]?.id);
  const selected = selections.find((s) => s.id === selectedId) ?? selections[0];

  return (
    <Row gutter={16}>
      <Col xs={24} md={7}>
        <Card title="组包" size="small">
          <List
            dataSource={selections}
            renderItem={(sel) => (
              <List.Item
                onClick={() => setSelectedId(sel.id)}
                style={{
                  cursor: "pointer",
                  background: sel.id === selected?.id ? "#232733" : undefined,
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      {sel.name}
                      <EnumTag
                        enumName="SelectionStatus"
                        value={sel.status}
                        colorMap={SELECTION_COLOR}
                      />
                    </Space>
                  }
                  description={
                    <span style={{ fontSize: 12, color: "#8b90a0" }}>
                      {sel.rules.length} 条规则 · {sel.items.length} 张已选
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} md={17}>
        <Card title={selected ? `配额规则 · ${selected.name}` : "配额规则"} size="small">
          {selected && <RuleTable selection={selected} />}
        </Card>
      </Col>
    </Row>
  );
}

export function SelectionPage() {
  const state = useAsync(() => api.listSelections(), []);
  return (
    <>
      <PageHeader title="组包" subtitle="按配额规则选片并跟踪缺口" />
      <AsyncBoundary state={state}>
        {(selections) =>
          selections.length === 0 ? (
            <PageHeader title="暂无组包" />
          ) : (
            <SelectionContent selections={selections} />
          )
        }
      </AsyncBoundary>
    </>
  );
}
