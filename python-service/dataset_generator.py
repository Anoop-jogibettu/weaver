import pandas as pd
import numpy as np
from pathlib import Path
import random

# The 12 features expected by the Weaver ML model
FEATURE_COLS = [
    "same_node_type", "same_name", "same_function", "same_class",
    "line_overlap", "overlap_ratio", "structural_distance",
    "op_combo_score", "both_modify", "delete_and_modify",
    "node_type_a", "node_type_b",
]

def generate_synthetic_dataset(num_samples=5000, output_path="dataset.csv"):
    print(f"Generating synthetic dataset with {num_samples} samples...")
    data = []
    
    for _ in range(num_samples):
        # Generate randomized base features
        same_node_type = random.choice([0, 1])
        same_name = random.choice([0, 1]) if same_node_type else 0
        same_function = random.choice([0, 1])
        same_class = random.choice([0, 1])
        line_overlap = random.choice([0, 1])
        
        # If lines overlap, the structural distance is 0 and overlap ratio is > 0
        if line_overlap:
            overlap_ratio = round(random.uniform(0.1, 1.0), 2)
            structural_distance = 0
        else:
            overlap_ratio = 0.0
            structural_distance = random.randint(1, 100)
            
        both_modify = random.choice([0, 1])
        delete_and_modify = 1 if not both_modify and random.choice([0, 1]) else 0
        
        # op_combo_score: modify+modify=3, delete+modify=4, other=1 or 2
        if both_modify:
            op_combo_score = 3
        elif delete_and_modify:
            op_combo_score = 4
        else:
            op_combo_score = random.choice([1, 2])
            
        node_type_a = random.randint(1, 15) # Example AST node type IDs
        node_type_b = node_type_a if same_node_type else random.randint(1, 15)

        # --- LOGIC TO DETERMINE THE LABEL (0 = Compatible, 1 = Conflict) ---
        label = 0
        
        # Severe conflict: editing the exact same lines
        if line_overlap and overlap_ratio > 0.5:
            label = 1
            
        # Severe conflict: one deletes a function while another modifies it
        if delete_and_modify and same_function:
            label = 1
            
        # Moderate conflict: modifying the same exact variable/identifier name in the same function
        if same_function and same_name and both_modify:
            label = 1
            
        # Add a tiny bit of noise (5%) to make the ML model work harder
        if random.random() < 0.05:
            label = 1 if label == 0 else 0

        # Append to data
        data.append([
            same_node_type, same_name, same_function, same_class,
            line_overlap, overlap_ratio, structural_distance,
            op_combo_score, both_modify, delete_and_modify,
            node_type_a, node_type_b, label
        ])
        
    # Create DataFrame
    columns = FEATURE_COLS + ["label"]
    df = pd.DataFrame(data, columns=columns)
    
    # Save to CSV
    df.to_csv(output_path, index=False)
    print(f"Dataset successfully generated and saved to {output_path}")
    print(f"Class distribution:\n{df['label'].value_counts()}")
    return df

if __name__ == "__main__":
    generate_synthetic_dataset()
