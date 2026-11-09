import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// 角色字号属于 font-size 分组，和文字颜色同时保留。此列表对应 tokens.css。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro",
            "caption",
            "label",
            "body",
            "body-lg",
            "title-sm",
            "title",
            "title-lg",
            "display-sm",
            "display",
          ],
        },
      ],
    },
  },
})

/** 合并多个 className：先拼接再去掉互相冲突的 Tailwind 工具类 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
