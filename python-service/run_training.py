import pandas as pd
from ml.classifier import train

OUTPUT_CSV = "dataset_real.csv"
print("Loading real dataset...")
df = pd.read_csv(OUTPUT_CSV, skipinitialspace=True)

# Clean column names in case they have spaces
df.columns = df.columns.str.strip()

print(f"Loaded {len(df)} samples.")
print("\nClass distribution:")
print(df["label"].value_counts().to_string())

print("\nTraining Random Forest model on 80,000+ real samples...")
results = train(df.drop(columns=["label"]).assign(label=df["label"]))

print(f"\nResults on Real Data:")
print(f"  Accuracy : {results['accuracy']:.2%}")
print(f"  Precision: {results['precision']:.2%}")
print(f"  Recall   : {results['recall']:.2%}")
print(f"  F1 Score : {results['f1']:.2%}")
print("\n✓ Model successfully upgraded and saved to ml/model.joblib!")
