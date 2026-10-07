'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// A country-code dropdown in front of the number. The WhatsApp service stores numbers as
// E.164 (+27721184460), so this hands back '+<code><number>', with the trunk 0 of a local
// form like 072 118 4460 dropped, or '' when the number is blank.

/** [ISO code, name, dialling code]. North American Caribbean numbers fall under +1. */
const COUNTRIES: [string, string, string][] = [
  ['AF', 'Afghanistan', '93'], ['AL', 'Albania', '355'], ['DZ', 'Algeria', '213'],
  ['AD', 'Andorra', '376'], ['AO', 'Angola', '244'], ['AR', 'Argentina', '54'],
  ['AM', 'Armenia', '374'], ['AW', 'Aruba', '297'], ['AU', 'Australia', '61'],
  ['AT', 'Austria', '43'], ['AZ', 'Azerbaijan', '994'], ['BH', 'Bahrain', '973'],
  ['BD', 'Bangladesh', '880'], ['BY', 'Belarus', '375'], ['BE', 'Belgium', '32'],
  ['BZ', 'Belize', '501'], ['BJ', 'Benin', '229'], ['BT', 'Bhutan', '975'],
  ['BO', 'Bolivia', '591'], ['BA', 'Bosnia and Herzegovina', '387'], ['BW', 'Botswana', '267'],
  ['BR', 'Brazil', '55'], ['BN', 'Brunei', '673'], ['BG', 'Bulgaria', '359'],
  ['BF', 'Burkina Faso', '226'], ['BI', 'Burundi', '257'], ['KH', 'Cambodia', '855'],
  ['CM', 'Cameroon', '237'], ['CA', 'Canada', '1'], ['CV', 'Cape Verde', '238'],
  ['CF', 'Central African Republic', '236'], ['TD', 'Chad', '235'], ['CL', 'Chile', '56'],
  ['CN', 'China', '86'], ['CO', 'Colombia', '57'], ['KM', 'Comoros', '269'],
  ['CG', 'Congo', '242'], ['CD', 'Congo (DRC)', '243'], ['CR', 'Costa Rica', '506'],
  ['CI', "Côte d'Ivoire", '225'], ['HR', 'Croatia', '385'], ['CU', 'Cuba', '53'],
  ['CY', 'Cyprus', '357'], ['CZ', 'Czechia', '420'], ['DK', 'Denmark', '45'],
  ['DJ', 'Djibouti', '253'], ['EC', 'Ecuador', '593'], ['EG', 'Egypt', '20'],
  ['SV', 'El Salvador', '503'], ['GQ', 'Equatorial Guinea', '240'], ['ER', 'Eritrea', '291'],
  ['EE', 'Estonia', '372'], ['SZ', 'Eswatini', '268'], ['ET', 'Ethiopia', '251'],
  ['FO', 'Faroe Islands', '298'], ['FJ', 'Fiji', '679'], ['FI', 'Finland', '358'],
  ['FR', 'France', '33'], ['PF', 'French Polynesia', '689'], ['GA', 'Gabon', '241'],
  ['GM', 'Gambia', '220'], ['GE', 'Georgia', '995'], ['DE', 'Germany', '49'],
  ['GH', 'Ghana', '233'], ['GI', 'Gibraltar', '350'], ['GR', 'Greece', '30'],
  ['GL', 'Greenland', '299'], ['GT', 'Guatemala', '502'], ['GN', 'Guinea', '224'],
  ['GW', 'Guinea-Bissau', '245'], ['GY', 'Guyana', '592'], ['HT', 'Haiti', '509'],
  ['HN', 'Honduras', '504'], ['HK', 'Hong Kong', '852'], ['HU', 'Hungary', '36'],
  ['IS', 'Iceland', '354'], ['IN', 'India', '91'], ['ID', 'Indonesia', '62'],
  ['IR', 'Iran', '98'], ['IQ', 'Iraq', '964'], ['IE', 'Ireland', '353'],
  ['IL', 'Israel', '972'], ['IT', 'Italy', '39'], ['JP', 'Japan', '81'],
  ['JO', 'Jordan', '962'], ['KZ', 'Kazakhstan', '7'], ['KE', 'Kenya', '254'],
  ['XK', 'Kosovo', '383'], ['KW', 'Kuwait', '965'], ['KG', 'Kyrgyzstan', '996'],
  ['LA', 'Laos', '856'], ['LV', 'Latvia', '371'], ['LB', 'Lebanon', '961'],
  ['LS', 'Lesotho', '266'], ['LR', 'Liberia', '231'], ['LY', 'Libya', '218'],
  ['LI', 'Liechtenstein', '423'], ['LT', 'Lithuania', '370'], ['LU', 'Luxembourg', '352'],
  ['MO', 'Macau', '853'], ['MG', 'Madagascar', '261'], ['MW', 'Malawi', '265'],
  ['MY', 'Malaysia', '60'], ['MV', 'Maldives', '960'], ['ML', 'Mali', '223'],
  ['MT', 'Malta', '356'], ['MR', 'Mauritania', '222'], ['MU', 'Mauritius', '230'],
  ['MX', 'Mexico', '52'], ['MD', 'Moldova', '373'], ['MC', 'Monaco', '377'],
  ['MN', 'Mongolia', '976'], ['ME', 'Montenegro', '382'], ['MA', 'Morocco', '212'],
  ['MZ', 'Mozambique', '258'], ['MM', 'Myanmar', '95'], ['NA', 'Namibia', '264'],
  ['NP', 'Nepal', '977'], ['NL', 'Netherlands', '31'], ['NC', 'New Caledonia', '687'],
  ['NZ', 'New Zealand', '64'], ['NI', 'Nicaragua', '505'], ['NE', 'Niger', '227'],
  ['NG', 'Nigeria', '234'], ['KP', 'North Korea', '850'], ['MK', 'North Macedonia', '389'],
  ['NO', 'Norway', '47'], ['OM', 'Oman', '968'], ['PK', 'Pakistan', '92'],
  ['PS', 'Palestine', '970'], ['PA', 'Panama', '507'], ['PG', 'Papua New Guinea', '675'],
  ['PY', 'Paraguay', '595'], ['PE', 'Peru', '51'], ['PH', 'Philippines', '63'],
  ['PL', 'Poland', '48'], ['PT', 'Portugal', '351'], ['QA', 'Qatar', '974'],
  ['RE', 'Réunion', '262'], ['RO', 'Romania', '40'], ['RU', 'Russia', '7'],
  ['RW', 'Rwanda', '250'], ['SH', 'Saint Helena', '290'], ['WS', 'Samoa', '685'],
  ['SM', 'San Marino', '378'], ['ST', 'São Tomé and Príncipe', '239'], ['SA', 'Saudi Arabia', '966'],
  ['SN', 'Senegal', '221'], ['RS', 'Serbia', '381'], ['SC', 'Seychelles', '248'],
  ['SL', 'Sierra Leone', '232'], ['SG', 'Singapore', '65'], ['SK', 'Slovakia', '421'],
  ['SI', 'Slovenia', '386'], ['SB', 'Solomon Islands', '677'], ['SO', 'Somalia', '252'],
  ['ZA', 'South Africa', '27'], ['KR', 'South Korea', '82'], ['SS', 'South Sudan', '211'],
  ['ES', 'Spain', '34'], ['LK', 'Sri Lanka', '94'], ['SD', 'Sudan', '249'],
  ['SR', 'Suriname', '597'], ['SE', 'Sweden', '46'], ['CH', 'Switzerland', '41'],
  ['SY', 'Syria', '963'], ['TW', 'Taiwan', '886'], ['TJ', 'Tajikistan', '992'],
  ['TZ', 'Tanzania', '255'], ['TH', 'Thailand', '66'], ['TL', 'Timor-Leste', '670'],
  ['TG', 'Togo', '228'], ['TO', 'Tonga', '676'], ['TN', 'Tunisia', '216'],
  ['TR', 'Turkey', '90'], ['TM', 'Turkmenistan', '993'], ['UG', 'Uganda', '256'],
  ['UA', 'Ukraine', '380'], ['AE', 'United Arab Emirates', '971'], ['GB', 'United Kingdom', '44'],
  ['US', 'United States', '1'], ['UY', 'Uruguay', '598'], ['UZ', 'Uzbekistan', '998'],
  ['VU', 'Vanuatu', '678'], ['VE', 'Venezuela', '58'], ['VN', 'Vietnam', '84'],
  ['YE', 'Yemen', '967'], ['ZM', 'Zambia', '260'], ['ZW', 'Zimbabwe', '263'],
]

const DIAL = new Map(COUNTRIES.map(([iso, , dial]) => [iso, dial]))
const DEFAULT_COUNTRY = 'ZA'
/** Which country a shared code reads as, unless the admin picked the other one. */
const SHARED_CODE: Record<string, string> = { '1': 'US', '7': 'RU' }

/** Splits a stored number into its country and the rest. Numbers without a + are local. */
export function splitPhone(value: string, preferred = DEFAULT_COUNTRY) {
  const raw = value.trim()
  if (!raw.startsWith('+')) return { country: preferred, national: raw }
  const digits = raw.replace(/\D/g, '')
  const matches = COUNTRIES.filter(([, , dial]) => digits.startsWith(dial))
  if (matches.length === 0) return { country: preferred, national: raw }
  const longest = Math.max(...matches.map(([, , dial]) => dial.length))
  const best = matches.filter(([, , dial]) => dial.length === longest).map(([iso]) => iso)
  const dial = DIAL.get(best[0])!
  const country = best.includes(preferred) ? preferred : SHARED_CODE[dial] ?? best[0]
  return { country, national: digits.slice(dial.length) }
}

export function joinPhone(country: string, national: string) {
  const digits = national.replace(/\D/g, '').replace(/^0+/, '')
  return digits ? `+${DIAL.get(country) ?? DIAL.get(DEFAULT_COUNTRY)}${digits}` : ''
}

export function PhoneInput({
  value, onChange, className,
}: {
  value: string; onChange: (value: string) => void; className?: string
}) {
  const [country, setCountry] = useState(() => splitPhone(value).country)
  const [national, setNational] = useState(() => splitPhone(value).national)
  // What this field last handed up. Anything else arriving in `value` (the saved, cleaned
  // number, another driver's row) replaces what is shown; our own echo does not, so a
  // leading 0 the admin is still typing stays on screen.
  const [last, setLast] = useState(value)
  if (value !== last) {
    const parts = splitPhone(value, country)
    setLast(value); setCountry(parts.country); setNational(parts.national)
  }

  function emit(nextCountry: string, nextNational: string) {
    const next = joinPhone(nextCountry, nextNational)
    setCountry(nextCountry); setNational(nextNational); setLast(next)
    onChange(next)
  }

  return (
    <div className={cn(
      'flex w-full rounded border border-gray-200 bg-white text-sm focus-within:ring-1 focus-within:ring-gray-400',
      className,
    )}>
      <div className="relative flex shrink-0 items-center gap-1 border-r border-gray-200 pl-2.5 pr-1.5 text-gray-700">
        <span className="text-xs text-gray-400">{country}</span>
        <span>+{DIAL.get(country)}</span>
        <ChevronDown size={13} className="text-gray-400" />
        <select
          aria-label="Country code"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={country}
          onChange={e => emit(e.target.value, national)}
        >
          {COUNTRIES.map(([iso, name, dial]) => (
            <option key={iso} value={iso}>{name} (+{dial})</option>
          ))}
        </select>
      </div>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        aria-label="Phone number"
        className="min-w-0 flex-1 rounded-r bg-transparent px-2.5 py-1.5 focus:outline-none"
        value={national}
        onChange={e => emit(country, e.target.value)}
      />
    </div>
  )
}
