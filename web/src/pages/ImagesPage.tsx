import { useMemo, useState } from "react";
import {
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Row,
  Select,
  Space,
} from "antd";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { Thumbnail } from "@/components/Thumbnail";
import { ORIENTATION_COLOR, REVIEW_COLOR, USABILITY_COLOR } from "@/colors";
import type { ImageFilterParams, ImageModel, PersonCluster } from "@/api/types";

const ANY = "__any__";

function EnumSelect({
  enumName,
  placeholder,
  value,
  onChange,
}: {
  enumName: string;
  placeholder: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const { entries } = useLabels();
  return (
    <Select
      allowClear
      style={{ width: 150 }}
      placeholder={placeholder}
      value={value ?? undefined}
      onChange={(v) => onChange(v === ANY ? undefined : v)}
      options={entries(enumName).map((e) => ({ value: e.value, label: e.label }))}
    />
  );
}

function ImageCard({
  image,
  onClick,
}: {
  image: ImageModel;
  onClick: () => void;
}) {
  return (
    <Card
      hoverable
      size="small"
      styles={{ body: { padding: 8 } }}
      onClick={onClick}
    >
      <Thumbnail seed={image.thumbnail_hint || image.id} size={150} />
      <div style={{ marginTop: 8 }}>
        <Space size={4} wrap>
          <EnumTag
            enumName="Orientation"
            value={image.orientation}
            colorMap={ORIENTATION_COLOR}
          />
          <EnumTag
            enumName="Usability"
            value={image.usability}
            colorMap={USABILITY_COLOR}
          />
        </Space>
      </div>
      <div style={{ marginTop: 4, fontSize: 12, color: "#8b90a0" }}>
        {image.id} · Q{image.quality_score.toFixed(2)}
      </div>
    </Card>
  );
}

function DetailPanel({
  image,
  people,
}: {
  image: ImageModel;
  people: PersonCluster[];
}) {
  const { label } = useLabels();
  const person = people.find((p) => p.id === image.primary_subject_id);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Thumbnail seed={image.thumbnail_hint || image.id} size={280} ratio={image.width / image.height} />
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="ID">{image.id}</Descriptions.Item>
        <Descriptions.Item label="尺寸">
          {image.width} × {image.height}
        </Descriptions.Item>
        <Descriptions.Item label="质量分">
          {image.quality_score.toFixed(3)}
        </Descriptions.Item>
        <Descriptions.Item label="朝向">
          <EnumTag enumName="Orientation" value={image.orientation} colorMap={ORIENTATION_COLOR} />
        </Descriptions.Item>
        <Descriptions.Item label="可用性">
          <EnumTag enumName="Usability" value={image.usability} colorMap={USABILITY_COLOR} />
        </Descriptions.Item>
        <Descriptions.Item label="复核状态">
          <EnumTag enumName="ReviewStatus" value={image.review_status} colorMap={REVIEW_COLOR} />
        </Descriptions.Item>
        <Descriptions.Item label="脸部完整度">
          {label("FaceCompleteness", image.face_completeness)}
        </Descriptions.Item>
        <Descriptions.Item label="主体人物">
          {person ? person.display_name : "-"}
        </Descriptions.Item>
        <Descriptions.Item label="质量问题">
          {image.quality_flags.length
            ? image.quality_flags.map((f) => label("QualityFlag", f)).join("、")
            : "无"}
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

export function ImagesPage() {
  const [filter, setFilter] = useState<ImageFilterParams>({});
  const [selected, setSelected] = useState<ImageModel | null>(null);

  const imagesState = useAsync(
    () => api.listImages(filter),
    [filter.person_id, filter.orientation, filter.usability, filter.review_status, filter.keyword],
  );
  const peopleState = useAsync(() => api.listPeople(), []);
  const people = peopleState.data ?? [];

  const patch = (part: Partial<ImageFilterParams>) =>
    setFilter((prev) => ({ ...prev, ...part }));

  const personOptions = useMemo(
    () => people.map((p) => ({ value: p.id, label: p.display_name })),
    [people],
  );

  return (
    <>
      <PageHeader title="图片库" subtitle="浏览、筛选与查看详情" />

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          style={{ width: 160 }}
          placeholder="人物"
          value={filter.person_id ?? undefined}
          onChange={(v) => patch({ person_id: v ?? undefined })}
          options={personOptions}
        />
        <EnumSelect
          enumName="Orientation"
          placeholder="朝向"
          value={filter.orientation}
          onChange={(v) => patch({ orientation: v })}
        />
        <EnumSelect
          enumName="Usability"
          placeholder="可用性"
          value={filter.usability}
          onChange={(v) => patch({ usability: v })}
        />
        <EnumSelect
          enumName="ReviewStatus"
          placeholder="复核状态"
          value={filter.review_status}
          onChange={(v) => patch({ review_status: v })}
        />
        <Input.Search
          allowClear
          placeholder="按 ID 搜索"
          style={{ width: 200 }}
          onSearch={(v) => patch({ keyword: v || undefined })}
        />
      </Space>

      <AsyncBoundary state={imagesState}>
        {(images) =>
          images.length === 0 ? (
            <Empty description="没有符合条件的图片" />
          ) : (
            <>
              <div style={{ marginBottom: 12, color: "#8b90a0" }}>
                共 {images.length} 张
              </div>
              <Row gutter={[12, 12]}>
                {images.map((image) => (
                  <Col key={image.id} xs={12} sm={8} md={6} lg={4}>
                    <ImageCard image={image} onClick={() => setSelected(image)} />
                  </Col>
                ))}
              </Row>
            </>
          )
        }
      </AsyncBoundary>

      <Drawer
        title={selected?.id ?? "图片详情"}
        width={420}
        open={selected !== null}
        onClose={() => setSelected(null)}
        destroyOnClose
      >
        {selected && <DetailPanel image={selected} people={people} />}
      </Drawer>
    </>
  );
}
