// SearchSelect.test.ts — Regresiones M1/M2 de la auditoría qa-ui/config-2026-08-22.
//
// M1: tras un scroll (closeOnScroll) el dropdown cierra pero el input CONSERVA el foco;
//     `@focus` no refire → el click no reabría y tipear appendeaba sobre el label cerrado
//     ("República DominicanaArgentina"). Reparación: `@mousedown` → openDropdown (idempotente).
// M2: selección por teclado inexistente — flechas navegan, Enter elige, Escape cierra.
//     Se protege también el salto de opciones deshabilitadas (#648) y los roles listbox/option.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

import SearchSelect from './SearchSelect.vue'

const COUNTRIES = ['Argentina', 'Brasil', 'Chile', 'República Dominicana']

// El dropdown va por <Teleport to="body">: los assertions de la lista se hacen sobre document.
function listbox(): HTMLElement | null {
  return document.querySelector('ul[role="listbox"]')
}

let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function render(options: unknown[] = COUNTRIES, modelValue = '') {
  wrapper = mount(SearchSelect, { props: { modelValue, options: options as never[] } })
  return wrapper
}

describe('SearchSelect — M1: el click reabre el dropdown aunque el input ya tenga foco', () => {
  it('tras un scroll que cierra el dropdown, mousedown sobre el input lo reabre', async () => {
    const w = render()
    const input = w.find('input')
    await input.trigger('focus')           // abre (path clásico)
    expect(listbox()).toBeTruthy()

    window.dispatchEvent(new Event('scroll')) // closeOnScroll cierra, el foco queda en el input
    await w.vm.$nextTick()
    expect(listbox()).toBeNull()

    await input.trigger('mousedown')       // ANTES del fix: no reabría nunca
    await w.vm.$nextTick()
    expect(listbox()).toBeTruthy()
  })

  it('al reabrir limpia el query: tipear no appendea sobre el label cerrado', async () => {
    const w = render(COUNTRIES, 'República Dominicana')
    const input = w.find('input')
    await input.trigger('focus')
    window.dispatchEvent(new Event('scroll'))
    await w.vm.$nextTick()

    await input.trigger('mousedown')
    expect((input.element as HTMLInputElement).value).toBe('') // query vacío, no el label

    input.setValue('Arg')
    await w.vm.$nextTick()
    const items = Array.from(listbox()!.querySelectorAll('li'))
    expect(items.map((li) => li.textContent)).toEqual(['Argentina'])
  })
})

describe('SearchSelect — M2: selección por teclado (combobox)', () => {
  it('ArrowDown activa la primera opción, Enter la selecciona y cierra', async () => {
    const w = render()
    const input = w.find('input')
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('update:modelValue')![0]).toEqual(['Argentina'])
    expect(listbox()).toBeNull()
  })

  it('dos ArrowDown activan la segunda; Enter elige esa y no la primera', async () => {
    const w = render()
    const input = w.find('input')
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('update:modelValue')![0]).toEqual(['Brasil'])
  })

  it('ArrowUp sobre la primera opción es no-op: la activa se mantiene', async () => {
    const w = render()
    const input = w.find('input')
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowUp' }) // no baja de la primera
    await input.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('update:modelValue')![0]).toEqual(['Argentina'])
  })

  it('Enter sin opción activa no elige nada ni cierra', async () => {
    const w = render()
    const input = w.find('input')
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(listbox()).toBeTruthy()
  })

  it('flechas abren el dropdown si estaba cerrado (como un select nativo)', async () => {
    const w = render()
    const input = w.find('input')
    await input.trigger('focus')
    window.dispatchEvent(new Event('scroll'))
    await w.vm.$nextTick()
    expect(listbox()).toBeNull()

    await input.trigger('keydown', { key: 'ArrowDown' })
    await w.vm.$nextTick()
    expect(listbox()).toBeTruthy()
  })

  it('Escape cierra y limpia el query', async () => {
    const w = render()
    const input = w.find('input')
    await input.trigger('focus')
    input.setValue('Chi')
    await input.trigger('keydown', { key: 'Escape' })

    expect(listbox()).toBeNull()
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('la opción deshabilitada se salta con el teclado y no se elige con Enter', async () => {
    const w = render([
      { value: 'arg', label: 'Argentina', disabled: true },
      { value: 'bra', label: 'Brasil' },
    ])
    const input = w.find('input')
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' }) // salta Argentina (disabled)
    await input.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('update:modelValue')![0]).toEqual(['bra'])
  })

  it('expone roles combobox/listbox/option y aria-activedescendant apunta a la activa', async () => {
    const w = render()
    const input = w.find('input')
    expect(input.attributes('role')).toBe('combobox')
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })

    const activeId = input.attributes('aria-activedescendant')
    expect(activeId).toBeTruthy()
    const active = document.getElementById(activeId!)
    expect(active?.getAttribute('role')).toBe('option')
    expect(active?.textContent).toBe('Argentina')
    expect(listbox()!.getAttribute('role')).toBe('listbox')
  })
})
