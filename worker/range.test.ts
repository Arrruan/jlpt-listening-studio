import { describe, expect, it } from 'vitest'
import { parseByteRange } from './range'

describe('R2 音频 Range 请求', () => {
  it('解析固定、开放和后缀区间', () => {
    expect(parseByteRange('bytes=0-499', 1000)).toEqual({ valid: true, offset: 0, length: 500 })
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ valid: true, offset: 500, length: 500 })
    expect(parseByteRange('bytes=-200', 1000)).toEqual({ valid: true, offset: 800, length: 200 })
  })

  it('把超出文件末尾的结束位置截断', () => {
    expect(parseByteRange('bytes=900-2000', 1000)).toEqual({ valid: true, offset: 900, length: 100 })
  })

  it('拒绝多区间和越界请求', () => {
    expect(parseByteRange('bytes=0-1,4-5', 1000)).toEqual({ valid: false })
    expect(parseByteRange('bytes=1000-', 1000)).toEqual({ valid: false })
    expect(parseByteRange('items=0-1', 1000)).toEqual({ valid: false })
  })
})
