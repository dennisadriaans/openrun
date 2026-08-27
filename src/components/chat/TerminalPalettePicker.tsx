/**
 * Which palette the debug transcript paints output with. Sits beside the debug
 * toggle and only while debug is on — it changes nothing in the ordinary UI.
 */
import { Palette } from 'lucide-react'
import { TERMINAL_PALETTES } from '../../lib/terminalPalette'
import { FooterMenu, MenuItem } from '../ComposerControls'
import { useChatTheme } from './ChatThemeProvider'

export function TerminalPalettePicker() {
  const { palette, setPalette } = useChatTheme()
  const current = TERMINAL_PALETTES.find((option) => option.id === palette) ?? TERMINAL_PALETTES[0]!

  return (
    <FooterMenu
      label={current.label}
      align="end"
      tooltip="Terminal palette"
      leading={<Palette className="h-3.5 w-3.5 shrink-0 text-tier-quaternary" />}
    >
      {(close) =>
        TERMINAL_PALETTES.map((option) => (
          <MenuItem
            key={option.id}
            active={option.id === palette}
            label={option.label}
            hint={option.hint}
            onSelect={() => {
              setPalette(option.id)
              close()
            }}
          />
        ))
      }
    </FooterMenu>
  )
}
