# Example data

`wisconsin-tumors.csv`: Breast Cancer Wisconsin (Diagnostic).

- 569 fine-needle-aspirate samples of breast masses; 212 malignant, 357 benign.
- Columns kept: Sample (row number in the original file order), Diagnosis, and four
  of the ten "mean" image measurements: radius, texture, area, concave points.
  Values are unchanged from the source (loaded through scikit-learn's bundled copy of the UCI file).
- Source: W. H. Wolberg, W. N. Street, O. L. Mangasarian, *Breast Cancer Wisconsin
  (Diagnostic)*, UCI Machine Learning Repository (1993). https://doi.org/10.24432/C5DW2B
- License: **CC BY 4.0**. Credit the authors and the UCI repository if you reuse it.
- Not medical advice and not a diagnostic tool: it is a teaching dataset.

In Tableau: X = Mean radius, Y = Mean concave points, Category = Diagnosis, Sample on Detail.
