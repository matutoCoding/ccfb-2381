import { describe, it, expect } from 'vitest';
import { parseBoreholeCsv, boreholesToCsv, parseCsv } from '../src/lib/csv';

const SAMPLE = `borehole_id,name,x,y,ground_elev,lithology_id,from_depth,to_depth
BH001,1号孔,100,200,45.0,FILL,0,2.5
BH001,1号孔,100,200,45.0,CLAY,2.5,8
BH002,2号孔,300,400,42.0,FILL,0,3
BH002,2号孔,300,400,42.0,SILT,3,7
`;

describe('CSV 解析', () => {
  it('解析多行钻孔并按孔合并、分层排序', () => {
    const { boreholes, errors } = parseBoreholeCsv(SAMPLE);
    expect(errors).toEqual([]);
    expect(boreholes).toHaveLength(2);
    const bh1 = boreholes.find((b) => b.id === 'BH001')!;
    expect(bh1.layers).toHaveLength(2);
    expect(bh1.layers[0]).toMatchObject({ lithologyId: 'FILL', fromDepth: 0, toDepth: 2.5 });
    expect(bh1.x).toBe(100);
  });

  it('支持中文列名与 BOM', () => {
    const text = `﻿钻孔编号,X,Y,孔口标高,岩性编号,层顶深度,层底深度\nZ1,1,2,40,A,0,2\n`;
    const rows = parseCsv(text);
    expect(rows[0].borehole_id).toBe('Z1');
    const { boreholes } = parseBoreholeCsv(text);
    expect(boreholes[0].layers[0].lithologyId).toBe('A');
  });

  it('缺列时报错', () => {
    const { boreholes, errors } = parseBoreholeCsv('a,b\n1,2\n');
    expect(boreholes).toHaveLength(0);
    expect(errors[0]).toContain('缺少必需列');
  });

  it('数字格式错误被收集且不中断解析', () => {
    const bad = `borehole_id,x,y,ground_elev,lithology_id,from_depth,to_depth
B1,1,2,xx,FILL,0,2
B2,3,4,40,FILL,0,abc
B3,5,6,41,FILL,0,3
`;
    const { boreholes, errors } = parseBoreholeCsv(bad);
    expect(errors.length).toBe(2);
    expect(boreholes.map((b) => b.id)).toEqual(['B3']);
  });

  it('往返序列化保持数据', () => {
    const first = parseBoreholeCsv(SAMPLE).boreholes;
    const text = boreholesToCsv(first);
    const second = parseBoreholeCsv(text).boreholes;
    expect(second).toEqual(first);
  });

  it('处理引号转义', () => {
    const rows = parseCsv('a,b\n"he,llo","q""x"\n');
    expect(rows[0].a).toBe('he,llo');
    expect(rows[0].b).toBe('q"x');
  });
});
