# Example data: WHO health indicators by region, 2019

`who-health-2019.csv` is 7 health indicators for the 6 WHO regions and the world (49 rows, one per region and
indicator). It is the data behind the Radar preview.

| Column | Meaning |
| --- | --- |
| WHO region | Africa, Americas, Eastern Mediterranean, Europe, South-East Asia, Western Pacific, plus Global. This is the Series |
| Indicator | A short name for the indicator. This is the Axis |
| Indicator long name | WHO's wording, for the Label shelf |
| Value | The 2019 value. Six indicators are percentages or a 0 to 100 index; life expectancy and healthy life expectancy are in years |

**Source and credit.** World Health Organization, Global Health Observatory (GHO) OData API
(https://www.who.int/data/gho/info/gho-odata-api), values for the year 2019, by WHO region. WHO data are
published under Creative Commons Attribution-NonCommercial-ShareAlike 3.0 IGO (CC BY-NC-SA 3.0 IGO). I only
selected the indicators and the year, shortened the indicator names for the Axis column, and kept WHO's own
wording in `Indicator long name`. WHO does not endorse this chart. Keep the credit and the non-commercial
licence if you reuse the file.

**Why it is a good radar.** Africa is the lowest region on all seven spokes (a UHC index of 48 against 82 in the
Americas), and the gap is widest on skilled birth care, 67.3% in Africa against 98.9% in Europe. The Global row makes
a natural benchmark: on the Benchmark tab choose A series, then pick Global, to see it as a dashed ring. All the
values sit between 48 and 99, so a shared 0 to 100 scale keeps the regions honestly comparable.

`dark-settings.json` is a settings file (the shape the Copy settings button produces) that gives the navy
Data Divers look used for the preview and the standalone page.
