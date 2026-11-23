# Example data: birth weights

`birth-weight.csv` is 189 babies born at Baystate Medical Center, Springfield, Massachusetts in 1986.

| Column | Meaning |
| --- | --- |
| Baby ID | Row number in the source table |
| Mother group | Mother's race as recorded in 1986 plus whether she smoked in pregnancy (6 groups) |
| Short name | A shorter name for the group, for the Label shelf |
| Mother smoked in pregnancy | Smoker or Non-smoker, for the Color shelf |
| Birth weight (g) | The baby's weight in grams. This is the Value |

**Source and credit.** The `birthwt` table in the R package MASS (Venables and Ripley), distributed through the
Rdatasets collection (https://vincentarelbundock.github.io/Rdatasets/doc/MASS/birthwt.html). The study is
Hosmer and Lemeshow, *Applied Logistic Regression* (1989). The group labels use the race categories as recorded
in that 1986 study. I only recoded the integer codes to words and added the two display columns. MASS is
distributed under GPL-2 or GPL-3; the data are credited here as the source asks, and no MASS code is used.

**Why it is a good ridgeline.** Median birth weight is lower for babies of mothers who smoked in two of the three
groups (White 3,593 g to 2,776 g, Black 2,920 g to 2,381 g). In the third group the order flips (2,807 g to 3,147 g), and it has
only 12 smokers, which is a good reminder to read n before the shape. Group sizes run from 10 to 55 babies:
enough for a density, few enough to read every name. The medians are computed from this file; the tooltip shows
the same numbers.

`dark-settings.json` is a settings file (the shape the Copy settings button produces) that gives the navy
Data Divers look used for the preview and the standalone page.
