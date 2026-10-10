import pandas as pd
from ml.classifier import train

def evaluate_algorithms():
    print("Loading simulated semantic dataset...")
    df = pd.read_csv("semantic_dataset_simulated.csv", skipinitialspace=True)
    df.columns = df.columns.str.strip()
    
    # Neutralize text leakage features (so model learns semantic structure)
    df["line_overlap"] = 0
    df["overlap_ratio"] = 0.0
    df["structural_distance"] = 0

    algorithms = ["random_forest", "logistic_regression", "gradient_boosting"]

    title = "Algorithm"
    print(f"\n{title.ljust(22)} | Accuracy | Precision | Recall | F1 Score")
    print("-" * 65)

    for algo in algorithms:
        res = train(df, algorithm=algo)
        acc = res["accuracy"]
        prec = res["precision"]
        rec = res["recall"]
        f1 = res["f1"]
        
        name = algo.replace("_", " ").title().ljust(22)
        print(f"{name} |  {acc:6.1%}  |  {prec:7.1%}  | {rec:5.1%}  | {f1:7.1%}")

if __name__ == "__main__":
    evaluate_algorithms()
