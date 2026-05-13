'use strict';
const fs = require('fs');
const path = require('path');
const locs = require('../server/data/locations.json');

const countryToContinent = {
  // Africa
  'Egypt': 'Africa', 'Nigeria': 'Africa', 'Kenya': 'Africa', 'South Africa': 'Africa',
  'Morocco': 'Africa', 'Ethiopia': 'Africa', 'Ghana': 'Africa', 'DR Congo': 'Africa',
  'Tanzania': 'Africa', 'Sudan': 'Africa', 'Algeria': 'Africa', 'Tunisia': 'Africa',
  'Senegal': 'Africa', 'Uganda': 'Africa', 'Zambia': 'Africa', 'Zimbabwe': 'Africa',
  'Mozambique': 'Africa', 'Madagascar': 'Africa', 'Mali': 'Africa', 'Burkina Faso': 'Africa',
  'Rwanda': 'Africa', 'Chad': 'Africa', 'Niger': 'Africa', 'Guinea': 'Africa',
  'Sierra Leone': 'Africa', 'Liberia': 'Africa', 'Gambia': 'Africa', 'Cape Verde': 'Africa',
  'Gabon': 'Africa', 'Republic of Congo': 'Africa', 'Central African Republic': 'Africa',
  'South Sudan': 'Africa', 'Eritrea': 'Africa', 'Djibouti': 'Africa', 'Somalia': 'Africa',
  'Angola': 'Africa', 'Namibia': 'Africa', 'Botswana': 'Africa', 'Lesotho': 'Africa',
  'Eswatini': 'Africa', 'Malawi': 'Africa', 'Burundi': 'Africa', 'Mauritius': 'Africa',
  'Seychelles': 'Africa', 'Comoros': 'Africa', 'São Tomé and Príncipe': 'Africa',
  'Equatorial Guinea': 'Africa', 'Guinea-Bissau': 'Africa', 'Ivory Coast': 'Africa',
  'Togo': 'Africa', 'Benin': 'Africa', 'Cameroon': 'Africa', 'Libya': 'Africa',
  'Mauritania': 'Africa',
  // Asia
  'Japan': 'Asia', 'China': 'Asia', 'India': 'Asia', 'Indonesia': 'Asia',
  'Pakistan': 'Asia', 'Bangladesh': 'Asia', 'Vietnam': 'Asia', 'Thailand': 'Asia',
  'Myanmar': 'Asia', 'Malaysia': 'Asia', 'Philippines': 'Asia', 'Sri Lanka': 'Asia',
  'Nepal': 'Asia', 'Kazakhstan': 'Asia', 'Uzbekistan': 'Asia', 'Azerbaijan': 'Asia',
  'Georgia': 'Asia', 'Armenia': 'Asia', 'Turkey': 'Asia', 'Iran': 'Asia',
  'Iraq': 'Asia', 'Saudi Arabia': 'Asia', 'UAE': 'Asia', 'Jordan': 'Asia',
  'Israel': 'Asia', 'Lebanon': 'Asia', 'Syria': 'Asia', 'Kuwait': 'Asia',
  'Bahrain': 'Asia', 'Qatar': 'Asia', 'Oman': 'Asia', 'Yemen': 'Asia',
  'Afghanistan': 'Asia', 'Tajikistan': 'Asia', 'Kyrgyzstan': 'Asia',
  'Turkmenistan': 'Asia', 'Mongolia': 'Asia', 'North Korea': 'Asia',
  'South Korea': 'Asia', 'Taiwan': 'Asia', 'Cambodia': 'Asia', 'Laos': 'Asia',
  'Bhutan': 'Asia', 'East Timor': 'Asia', 'Brunei': 'Asia', 'Maldives': 'Asia',
  // Europe
  'UK': 'Europe', 'Scotland': 'Europe', 'France': 'Europe', 'Germany': 'Europe',
  'Italy': 'Europe', 'Spain': 'Europe', 'Portugal': 'Europe', 'Netherlands': 'Europe',
  'Belgium': 'Europe', 'Luxembourg': 'Europe', 'Switzerland': 'Europe', 'Austria': 'Europe',
  'Denmark': 'Europe', 'Sweden': 'Europe', 'Norway': 'Europe', 'Finland': 'Europe',
  'Iceland': 'Europe', 'Poland': 'Europe', 'Czech Republic': 'Europe', 'Slovakia': 'Europe',
  'Hungary': 'Europe', 'Romania': 'Europe', 'Bulgaria': 'Europe', 'Croatia': 'Europe',
  'Slovenia': 'Europe', 'Bosnia': 'Europe', 'Serbia': 'Europe', 'Montenegro': 'Europe',
  'Albania': 'Europe', 'Kosovo': 'Europe', 'North Macedonia': 'Europe', 'Greece': 'Europe',
  'Cyprus': 'Europe', 'Estonia': 'Europe', 'Latvia': 'Europe', 'Lithuania': 'Europe',
  'Moldova': 'Europe', 'Ukraine': 'Europe', 'Belarus': 'Europe', 'Russia': 'Europe',
  'Malta': 'Europe', 'Liechtenstein': 'Europe', 'Ireland': 'Europe',
  // North America
  'USA': 'North America', 'Canada': 'North America', 'Mexico': 'North America',
  'Belize': 'North America', 'Guatemala': 'North America', 'El Salvador': 'North America',
  'Honduras': 'North America', 'Nicaragua': 'North America', 'Costa Rica': 'North America',
  'Panama': 'North America', 'Cuba': 'North America', 'Jamaica': 'North America',
  'Haiti': 'North America', 'Dominican Rep.': 'North America', 'Puerto Rico': 'North America',
  'Bahamas': 'North America', 'Barbados': 'North America', 'Trinidad': 'North America',
  'Saint Kitts and Nevis': 'North America', 'Antigua and Barbuda': 'North America',
  'Dominica': 'North America', 'Saint Lucia': 'North America',
  'Saint Vincent and the Grenadines': 'North America', 'Grenada': 'North America',
  // US States (country-part extracted from "City, State, USA" names)
  'Alabama, USA': 'North America', 'Arkansas, USA': 'North America',
  'Connecticut, USA': 'North America', 'Delaware, USA': 'North America',
  'Idaho, USA': 'North America', 'Iowa, USA': 'North America',
  'Kentucky, USA': 'North America', 'Maine, USA': 'North America',
  'Mississippi, USA': 'North America', 'Montana, USA': 'North America',
  'Nebraska, USA': 'North America', 'New Hampshire, USA': 'North America',
  'New Jersey, USA': 'North America', 'New Mexico, USA': 'North America',
  'North Dakota, USA': 'North America', 'Rhode Island, USA': 'North America',
  'South Carolina, USA': 'North America', 'South Dakota, USA': 'North America',
  'Vermont, USA': 'North America', 'Virginia, USA': 'North America',
  'West Virginia, USA': 'North America', 'Wisconsin, USA': 'North America',
  'Wyoming, USA': 'North America',
  // South America
  'Brazil': 'South America', 'Argentina': 'South America', 'Chile': 'South America',
  'Colombia': 'South America', 'Venezuela': 'South America', 'Ecuador': 'South America',
  'Peru': 'South America', 'Bolivia': 'South America', 'Paraguay': 'South America',
  'Uruguay': 'South America', 'Guyana': 'South America', 'Suriname': 'South America',
  'French Guiana': 'South America',
  // Oceania
  'Australia': 'Oceania', 'New Zealand': 'Oceania', 'Papua New Guinea': 'Oceania',
  'Fiji': 'Oceania', 'Vanuatu': 'Oceania', 'Solomon Islands': 'Oceania',
  'Samoa': 'Oceania', 'Tonga': 'Oceania', 'Kiribati': 'Oceania',
  'Marshall Islands': 'Oceania', 'Micronesia': 'Oceania', 'Nauru': 'Oceania',
  'Tuvalu': 'Oceania', 'Palau': 'Oceania', 'Cook Islands': 'Oceania',
  'Easter Island': 'Oceania', 'French Polynesia': 'Oceania', 'New Caledonia': 'Oceania',
};

const nameOverrides = {
  'Singapore': 'Asia',
  'Hong Kong': 'Asia',
  'Monaco': 'Europe',
  'Andorra la Vella': 'Europe',
  'San Marino': 'Europe',
  'Macau': 'Asia',
};

const updated = locs.map(loc => {
  const cityOnly = loc.name.split(', ')[0];
  const country = loc.name.split(', ').slice(1).join(', ');
  const continent = nameOverrides[loc.name] || nameOverrides[cityOnly] || countryToContinent[country] || null;
  if (!continent) console.error('UNMAPPED:', loc.name, '| country-key:', country);
  return { ...loc, continent };
});

const missing = updated.filter(l => !l.continent);
if (missing.length > 0) {
  console.error('Aborting — fix mappings above first.');
  process.exit(1);
}

fs.writeFileSync(path.join(__dirname, '../server/data/locations.json'), JSON.stringify(updated, null, 2));
console.log('Done! Updated', updated.length, 'locations.');
