import React, { useState, useRef, useEffect } from 'react'

export default function EditableCell({ value, onSave, type = 'text', placeholder = '', className = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef(null)

  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    const newValue = type === 'number' ? draft : draft
    if (newValue !== value) {
      onSave(newValue)
    }
  }

  const displayValue = type === 'number'
    ? (value || value === 0 ? value : '')
    : (value || '')

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`editable-input ${className}`}
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={draft}
        onChange={(e) => setDraft(type === 'number' ? e.target.value : e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
          if (e.key === 'Tab') commit()
        }}
      />
    )
  }

  return (
    <span
      className={`editable-display ${className} ${!displayValue ? 'placeholder' : ''}`}
      onClick={() => setEditing(true)}
      tabIndex={0}
      onFocus={() => setEditing(true)}
    >
      {displayValue || placeholder || '点击编辑'}
    </span>
  )
}
