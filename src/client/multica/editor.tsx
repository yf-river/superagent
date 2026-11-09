/** Tiptap 编辑、Markdown 展示与选区格式工具栏；任务 API 接收 Markdown 字符串。 */
import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote } from 'lucide-react'
import { usePortalContainer } from './portal.tsx'
import { Button } from './button.tsx'
import type { T } from '../text.ts'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'

type EditorProps = {
  t: T; value: string; onChange?: (value: string) => void; label: string; placeholder?: string; disabled?: boolean; readOnly?: boolean; onFiles?: (files: File[]) => void
}
export function ContentEditor(props: EditorProps) {
  if (props.readOnly) return <div className="st-editor st-editor-readonly"><div className="st-prose" role="document" aria-label={props.label}><ReactMarkdown remarkPlugins={[remarkGfm]}>{props.value}</ReactMarkdown></div></div>
  return <EditableContent {...props}/>
}
function EditableContent({ t, value, onChange, label, placeholder, disabled = false, readOnly = false, onFiles }: EditorProps) {
  const container = usePortalContainer()
  const current = useRef({ onChange, onFiles }); current.current = { onChange, onFiles }
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: readOnly } }), Markdown, Image, TableKit],
    content: value, contentType: 'markdown', editable: !readOnly && !disabled,
    onUpdate: ({ editor }) => current.current.onChange?.(editor.getMarkdown()),
    editorProps: {
      attributes: { class: 'st-prose outline-none', role: readOnly ? 'document' : 'textbox', 'aria-label': label, 'aria-multiline': 'true', 'data-placeholder': placeholder ?? '' },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (!files.length || !current.current.onFiles) return false
        event.preventDefault(); current.current.onFiles(files); return true
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (!files.length || !current.current.onFiles) return false
        event.preventDefault(); current.current.onFiles(files); return true
      },
    },
  })
  useEffect(() => { editor?.setEditable(!readOnly && !disabled) }, [editor, readOnly, disabled])
  useEffect(() => {
    if (editor && (readOnly || !editor.isFocused) && editor.getMarkdown() !== value) editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value, readOnly])
  useEditorState({editor,selector:({editor})=>editor?JSON.stringify([editor.state.selection.from,editor.state.selection.to,editor.getAttributes('textStyle'),editor.isActive('bold'),editor.isActive('italic'),editor.isActive('strike'),editor.isActive('code'),editor.isActive('bulletList'),editor.isActive('orderedList'),editor.isActive('blockquote')]):''})
  const formats = [
    {name:'bold',icon:Bold,run:()=>editor?.chain().focus().toggleBold().run()},
    {name:'italic',icon:Italic,run:()=>editor?.chain().focus().toggleItalic().run()},
    {name:'strike',icon:Strikethrough,run:()=>editor?.chain().focus().toggleStrike().run()},
    {name:'code',icon:Code,run:()=>editor?.chain().focus().toggleCode().run()},
    {name:'bulletList',icon:List,run:()=>editor?.chain().focus().toggleBulletList().run()},
    {name:'orderedList',icon:ListOrdered,run:()=>editor?.chain().focus().toggleOrderedList().run()},
    {name:'blockquote',icon:Quote,run:()=>editor?.chain().focus().toggleBlockquote().run()},
  ] as const
  return <div className="st-editor"><EditorContent editor={editor}/>{editor && container && <BubbleMenu editor={editor} appendTo={container} options={{placement:'top',offset:8,flip:true,shift:{padding:8},strategy:'fixed'}} className="st-format-menu" onMouseDown={event=>event.preventDefault()}>
    {formats.map(format=><Button key={format.name} variant="ghost" size="icon-xs" aria-label={t(`task.format.${format.name}`)} title={t(`task.format.${format.name}`)} aria-pressed={editor.isActive(format.name)} className={editor.isActive(format.name)?'bg-accent':''} onClick={format.run}><format.icon className="size-3.5"/></Button>)}
  </BubbleMenu>}</div>
}
