import zipfile
import os
import shutil

docx_path = r"d:\University\Graduation Project\Graduation_Project_1.docx"
assets_dir = r"d:\University\Graduation Project\slides\assets"

if not os.path.exists(assets_dir):
    os.makedirs(assets_dir)

def extract_images(docx_path, output_dir):
    with zipfile.ZipFile(docx_path, 'r') as docx_zip:
        file_list = docx_zip.namelist()
        media_files = [f for f in file_list if f.startswith('word/media/')]
        
        print(f"Found {len(media_files)} media files.")
        
        for media_file in media_files:
            # Extract to a temp location or directly read bytes
            file_data = docx_zip.read(media_file)
            file_name = os.path.basename(media_file)
            output_path = os.path.join(output_dir, file_name)
            
            with open(output_path, 'wb') as f:
                f.write(file_data)
            print(f"Extracted: {file_name}")

if __name__ == "__main__":
    extract_images(docx_path, assets_dir)
