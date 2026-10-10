from pathlib import Path
import tarfile,json,hashlib,os
r=Path(__file__).parent;source=Path('/private/tmp/orca-results-ccloop-20261010');archive=r/'result4-fix1-packaged'/'ccloop-0.1.0.tgz';dest=r/'result4-fix1-unpacked';dest.mkdir()
with tarfile.open(archive) as tar:
 for member in tar.getmembers():
  parts=Path(member.name).parts;assert parts and parts[0]=='package' and '..' not in parts and not Path(member.name).is_absolute() and (member.isfile() or member.isdir()),member.name
 tar.extractall(dest,filter='data')
os.symlink(source/'node_modules',dest/'package'/'node_modules')
files=[source/'dist'/'cli.js',*sorted((source/'dist'/'src').rglob('*.js'))];records=[]
for file in files:
 rel=file.relative_to(source);saved=dest/'package'/rel;assert saved.read_bytes()==file.read_bytes(),str(rel);records.append({'path':str(rel),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
(r/'result4-fix1-package-build-equality.json').write_text(json.dumps({'archive':str(archive),'archiveBytes':archive.stat().st_size,'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'matchedModules':records},indent=2)+'\n');print('package/source identical modules',len(records))
